"""SQLite persistence for the isolated lab. Documents freeze when a run starts."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import json
import sqlite3

from .config import data_dir
from .models import Document


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix: str) -> str:
    return f'{prefix}_{uuid4().hex}'


def encode(value) -> str:
    return json.dumps(value, ensure_ascii=False)


class Store:
    def __init__(self):
        self.root = data_dir()
        self.db = self.root / 'lab.sqlite3'
        with self.connection() as cx:
            cx.executescript('''
                CREATE TABLE IF NOT EXISTS analyses (
                  id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS documents (
                  id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES analyses(id),
                  side TEXT NOT NULL, storage_key TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS runs (
                  id TEXT PRIMARY KEY, analysis_id TEXT UNIQUE NOT NULL REFERENCES analyses(id),
                  state TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sources (
                  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
                  document_id TEXT NOT NULL REFERENCES documents(id), payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS findings (
                  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS reviews (
                  finding_id TEXT PRIMARY KEY REFERENCES findings(id), status TEXT NOT NULL,
                  note TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS translations (
                  run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL,
                  locale TEXT NOT NULL, payload TEXT NOT NULL,
                  PRIMARY KEY(run_id, revision, locale));
            ''')

    @contextmanager
    def connection(self):
        cx = sqlite3.connect(self.db, timeout=30)
        cx.row_factory = sqlite3.Row
        cx.execute('PRAGMA foreign_keys = ON')
        try:
            yield cx
            cx.commit()
        except BaseException:
            cx.rollback()
            raise
        finally:
            cx.close()

    def create_analysis(self, title: str) -> dict:
        row = {'id': uid('analysis'), 'title': title[:300], 'created_at': now()}
        with self.connection() as cx:
            cx.execute('INSERT INTO analyses VALUES (?, ?, ?)', tuple(row.values()))
        return row

    def list_analyses(self) -> list[dict]:
        with self.connection() as cx:
            return [dict(r) for r in cx.execute('''SELECT a.*, r.id AS run_id, r.state
                FROM analyses a LEFT JOIN runs r ON r.analysis_id=a.id ORDER BY a.created_at DESC''')]

    def analysis(self, analysis_id: str) -> dict:
        with self.connection() as cx:
            row = cx.execute('SELECT * FROM analyses WHERE id=?', (analysis_id,)).fetchone()
            if row is None:
                raise KeyError(analysis_id)
            docs = [json.loads(r['payload']) for r in cx.execute(
                'SELECT payload FROM documents WHERE analysis_id=? ORDER BY rowid', (analysis_id,))]
            run = cx.execute('SELECT id, state FROM runs WHERE analysis_id=?', (analysis_id,)).fetchone()
        return {**dict(row), 'documents': docs, 'run': dict(run) if run else None}

    def add_document(self, analysis_id: str, document: Document, content: bytes) -> None:
        directory = self.root / 'uploads'
        directory.mkdir(exist_ok=True)
        storage_key = f'uploads/{document.id}.{document.format}'
        target = self.root / storage_key
        with self.connection() as cx:
            cx.execute('BEGIN IMMEDIATE')
            if cx.execute('SELECT id FROM runs WHERE analysis_id=?', (analysis_id,)).fetchone():
                raise ValueError('Documents are immutable after start; create another analysis.')
            if not cx.execute('SELECT id FROM analyses WHERE id=?', (analysis_id,)).fetchone():
                raise KeyError(analysis_id)
            target.write_bytes(content)
            cx.execute('INSERT INTO documents VALUES (?, ?, ?, ?, ?)', (
                document.id, analysis_id, document.side, storage_key, document.model_dump_json()))

    def start(self, analysis_id: str, mode: str, language: str, model: str,
              allow_limited: bool) -> dict:
        with self.connection() as cx:
            cx.execute('BEGIN IMMEDIATE')
            existing = cx.execute('SELECT payload FROM runs WHERE analysis_id=?', (analysis_id,)).fetchone()
            if existing:
                return json.loads(existing['payload'])  # idempotent start
            if cx.execute("SELECT id FROM runs WHERE state IN ('queued','running')").fetchone():
                raise ValueError('One active lab run at a time. Use the current run or wait.')
            docs = [Document.model_validate_json(r['payload']) for r in cx.execute(
                'SELECT payload FROM documents WHERE analysis_id=? ORDER BY rowid', (analysis_id,))]
            if {d.side for d in docs} != {'before', 'after'}:
                raise ValueError('Upload at least one document on each side.')
            if any(d.parse_status == 'error' or not d.blocks for d in docs):
                raise ValueError('An unreadable document must be replaced; it cannot be silently skipped.')
            if any(d.parse_status == 'limited' or d.warnings for d in docs) and not allow_limited:
                raise ValueError('Parsing warnings require allow_limited=true; inspect document warnings first.')
            row = {
                'id': uid('run'), 'analysis_id': analysis_id, 'state': 'queued', 'stage': 'queued',
                'mode': mode, 'model': model if mode == 'live' else None, 'output_language': language,
                'pipeline_version': 'lab-0.1', 'review_revision': 0, 'started_at': now(),
                'finished_at': None, 'immutable_document_ids': [d.id for d in docs],
                'coverage': {}, 'errors': [], 'units': [], 'functions': [], 'findings': [],
                'trace': [], 'usage': {}, 'diff': {}, 'limitations': [w for d in docs for w in d.warnings],
            }
            cx.execute('INSERT INTO runs VALUES (?, ?, ?, ?)',
                       (row['id'], analysis_id, row['state'], encode(row)))
            for doc in docs:
                for source in doc.blocks:
                    cx.execute('INSERT INTO sources VALUES (?, ?, ?, ?)',
                               (source.id, row['id'], doc.id, source.model_dump_json()))
        return row

    def save_run(self, run: dict) -> None:
        with self.connection() as cx:
            cx.execute('BEGIN IMMEDIATE')
            existing = cx.execute('SELECT payload FROM runs WHERE id=?', (run['id'],)).fetchone()
            if not existing:
                raise KeyError(run['id'])
            # Only the pipeline writes here, before reviews become available.
            cx.execute('UPDATE runs SET state=?, payload=? WHERE id=?',
                       (run['state'], encode(run), run['id']))
            for finding in run['findings']:
                cx.execute('''INSERT INTO findings VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload''',
                           (finding['id'], run['id'], encode(finding)))

    def run(self, run_id: str) -> dict:
        with self.connection() as cx:
            cx.execute('BEGIN')  # payload/reviews must belong to the same revision
            row = cx.execute('SELECT payload FROM runs WHERE id=?', (run_id,)).fetchone()
            if row is None:
                raise KeyError(run_id)
            result = json.loads(row['payload'])
            reviews = {r['finding_id']: dict(r) for r in cx.execute('''SELECT v.* FROM reviews v
                JOIN findings f ON f.id=v.finding_id WHERE f.run_id=?''', (run_id,))}
        for finding in result['findings']:
            finding['review'] = reviews.get(finding['id'], {'status': 'unreviewed', 'note': ''})
            finding['source_ids'] = list(dict.fromkeys(e['source_id'] for e in finding['evidence']))
        return result

    def source(self, run_id: str, source_id: str) -> dict:
        with self.connection() as cx:
            row = cx.execute('SELECT payload FROM sources WHERE run_id=? AND id=?',
                             (run_id, source_id)).fetchone()
        if row is None:
            raise KeyError(source_id)
        return json.loads(row['payload'])

    def documents(self, run_id: str) -> list[Document]:
        run = self.run(run_id)
        return [Document.model_validate(d) for d in self.analysis(run['analysis_id'])['documents']]

    def review(self, run_id: str, finding_id: str, status: str, note: str) -> dict:
        if status not in {'confirmed', 'needs_clarification', 'rejected', 'unreviewed'}:
            raise ValueError('Unknown review status')
        with self.connection() as cx:
            cx.execute('BEGIN IMMEDIATE')
            if not cx.execute('SELECT id FROM findings WHERE id=? AND run_id=?', (finding_id, run_id)).fetchone():
                raise KeyError(finding_id)
            run = json.loads(cx.execute('SELECT payload FROM runs WHERE id=?', (run_id,)).fetchone()['payload'])
            if run['state'] in {'queued', 'running'}:
                raise ValueError('Wait until the run stops before reviewing.')
            cx.execute('''INSERT INTO reviews VALUES (?, ?, ?, ?) ON CONFLICT(finding_id)
                DO UPDATE SET status=excluded.status,note=excluded.note,updated_at=excluded.updated_at''',
                       (finding_id, status, note[:5000], now()))
            run['review_revision'] += 1
            cx.execute('UPDATE runs SET payload=? WHERE id=?', (encode(run), run_id))
        return {'finding_id': finding_id, 'status': status, 'review_revision': run['review_revision']}

    def translation(self, run_id: str, revision: int, locale: str) -> dict | None:
        with self.connection() as cx:
            row = cx.execute('SELECT payload FROM translations WHERE run_id=? AND revision=? AND locale=?',
                             (run_id, revision, locale)).fetchone()
        return json.loads(row['payload']) if row else None

    def save_translation(self, run_id: str, revision: int, locale: str, payload: dict) -> None:
        with self.connection() as cx:
            cx.execute('BEGIN IMMEDIATE')
            current = cx.execute('SELECT payload FROM runs WHERE id=?', (run_id,)).fetchone()
            if current is None or json.loads(current['payload'])['review_revision'] != revision:
                raise ValueError('Review changed during translation; request a fresh translation.')
            cx.execute('INSERT OR REPLACE INTO translations VALUES (?, ?, ?, ?)',
                       (run_id, revision, locale, encode(payload)))

    def recover_interrupted(self) -> int:
        with self.connection() as cx:
            rows = cx.execute("SELECT payload FROM runs WHERE state IN ('queued','running')").fetchall()
            for row in rows:
                run = json.loads(row['payload'])
                run.update(state='interrupted', stage='interrupted', finished_at=now())
                run['errors'].append('Previous process stopped before completion; create a new analysis to retry.')
                cx.execute('UPDATE runs SET state=?,payload=? WHERE id=?', ('interrupted', encode(run), run['id']))
        return len(rows)
