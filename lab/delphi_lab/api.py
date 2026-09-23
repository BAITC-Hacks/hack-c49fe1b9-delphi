"""Loopback-only lab API, separate from the team's backend."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Literal

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from .config import Settings, require_live_config
from .costs import RunCosts
from .models import Locale, Side
from .pipeline import execute_run, upload_bytes, translate_saved
from .reports import render_report, functions_csv
from .runtime import RuntimeLock
from .storage import Store, now
from .validation import materialize_evidence


@asynccontextmanager
async def lifespan(app: FastAPI):
    lock = RuntimeLock()
    lock.acquire()
    try:
        app.state.store = Store()
        app.state.store.recover_interrupted()
        app.state.settings = Settings()
        app.state.tasks = set()
        try:
            yield
        finally:
            if app.state.tasks:
                await asyncio.gather(*app.state.tasks, return_exceptions=True)
    finally:
        lock.release()


app = FastAPI(title='Delphi lab', version='0.2.0', lifespan=lifespan,
              description='Isolated document-processing API. /docs is the lab console, not the product UI. '
                          'Preprocess does not call an AI model. One process, one active run.')


@app.exception_handler(KeyError)
async def not_found(request, exc):
    return JSONResponse(status_code=404, content={'detail': 'Resource not found in this analysis/run.'})


@app.exception_handler(ValueError)
async def invalid(request, exc):
    return JSONResponse(status_code=422, content={'detail': str(exc)})


class AnalysisInput(BaseModel):
    title: str = Field(default='Lab comparison', min_length=1, max_length=300)


class RunInput(BaseModel):
    mode: Literal['preprocess', 'live'] = 'preprocess'
    language: Locale = 'ru'
    allow_limited: bool = False


class ReviewInput(BaseModel):
    status: Literal['unreviewed', 'confirmed', 'needs_clarification', 'rejected']
    note: str = Field(default='', max_length=5000)


class TranslationInput(BaseModel):
    language: Locale


class ResumeInput(BaseModel):
    max_calls: int | None = Field(default=None, gt=0)
    timeout_seconds: int | None = Field(default=None, gt=0)


def scheduled(run_id: str) -> bool:
    return any(not task.done() and task.get_name() == run_id for task in app.state.tasks)


def schedule_run(store: Store, run_id: str, settings: Settings, *, resume: bool = False) -> None:
    async def execute():
        try:
            await asyncio.to_thread(execute_run, store, run_id, settings, resume=resume)
        except Exception as exc:
            # Preflight failures can precede the pipeline's own checkpoint handler.
            # Preserve saved objects; never expose SDK/request exception bodies.
            saved = store.run(run_id)
            saved['errors'].append(f'Scheduled execution stopped ({type(exc).__name__}); saved results retained.')
            if saved['state'] in {'running', 'queued'}:
                saved.update(state='partial' if saved.get('functions') else 'failed',
                             stage='stopped', finished_at=now())
            store.save_run(saved)
    task = asyncio.create_task(execute(), name=run_id)
    app.state.tasks.add(task)
    task.add_done_callback(app.state.tasks.discard)


@app.get('/', include_in_schema=False)
def home():
    return HTMLResponse('<h1>Delphi lab</h1><p>Document parsing and bounded AI agent laboratory.</p>'
                        '<a href="/docs">Open API console</a> · <a href="/api/analyses">Saved analyses</a>')


@app.get('/api/analyses')
def history():
    return app.state.store.list_analyses()


@app.post('/api/analyses', status_code=201)
def create_analysis(payload: AnalysisInput):
    return app.state.store.create_analysis(payload.title)


@app.get('/api/analyses/{analysis_id}')
def get_analysis(analysis_id: str):
    analysis = app.state.store.analysis(analysis_id)
    for document in analysis['documents']:
        document['block_count'] = len(document.pop('blocks'))
    return analysis


@app.post('/api/analyses/{analysis_id}/documents', status_code=201)
async def documents(analysis_id: str, side: Side = Form(...), files: list[UploadFile] = File(...)):
    if len(files) > 20:
        raise ValueError('At most 20 files per upload request')
    app.state.store.analysis(analysis_id)
    saved = []
    # Successful files remain in the draft if a later upload fails; no file is silently skipped.
    for file in files:
        try:
            content = await file.read(20 * 1024 * 1024 + 1)
            result = await asyncio.to_thread(upload_bytes, app.state.store, analysis_id,
                                             file.filename or 'unnamed', side, content)
            saved.append(result)
        except ValueError as exc:
            return JSONResponse(status_code=422, content={'saved_documents': saved, 'detail': str(exc)})
        finally:
            await file.close()
    return saved


@app.post('/api/analyses/{analysis_id}/runs', status_code=202)
async def start(analysis_id: str, payload: RunInput):
    store, settings = app.state.store, app.state.settings
    if payload.mode == 'live':
        require_live_config(settings.model)
    existing = store.analysis(analysis_id)['run']
    # Resume is registered before its thread changes the saved state. Consult
    # scheduled tasks as well as Store.start's transactional active-run check.
    if existing is None and any(not task.done() for task in app.state.tasks):
        raise ValueError('Another lab run is active.')
    run = store.start(analysis_id, payload.mode, payload.language, settings.model, payload.allow_limited)
    if existing is None:
        schedule_run(store, run['id'], settings)
    return {'run_id': run['id'], 'state': run['state']}


@app.get('/api/runs/{run_id}')
def get_run(run_id: str):
    return app.state.store.run(run_id)


@app.post('/api/runs/{run_id}/resume', status_code=202)
async def resume(run_id: str, payload: ResumeInput):
    store = app.state.store
    run = store.run(run_id)
    if run['state'] not in {'partial', 'failed', 'interrupted'} or run['mode'] != 'live':
        raise ValueError('Only a stopped live run can be resumed.')
    if any(not task.done() for task in app.state.tasks):
        raise ValueError('Another lab run is active.')
    if any(f['review']['status'] != 'unreviewed' or f['review']['note'] for f in run['findings']):
        raise ValueError('Reviewed runs are frozen; create another analysis.')
    settings = replace(app.state.settings, **payload.model_dump(exclude_none=True))
    require_live_config(settings.model)
    if settings.model != run['model']:
        raise ValueError('A resumed run must use its original model.')
    schedule_run(store, run_id, settings, resume=True)
    return {'run_id': run_id, 'state': 'queued'}


@app.get('/api/runs/{run_id}/functions')
def functions(run_id: str):
    return app.state.store.run(run_id)['functions']


@app.get('/api/runs/{run_id}/structure')
def structure(run_id: str):
    run = app.state.store.run(run_id)
    return {'units': run['units'], 'changes': run.get('structure', []), 'coverage': run['coverage']}


@app.get('/api/runs/{run_id}/costs')
def run_costs(run_id: str):
    app.state.store.run(run_id)
    return RunCosts(run_id).snapshot()


@app.get('/api/runs/{run_id}/findings')
def findings(run_id: str):
    return app.state.store.run(run_id)['findings']


@app.get('/api/runs/{run_id}/sources/{source_id}')
def source(run_id: str, source_id: str):
    item = app.state.store.source(run_id, source_id)
    parents, visited = [], {item['id']}
    parent_id = item['parent_id']
    while parent_id and parent_id not in visited:
        parent = app.state.store.source(run_id, parent_id)
        visited.add(parent_id)
        parents.append(parent)
        parent_id = parent['parent_id']
    return {**item, 'parents': parents}


@app.get('/api/runs/{run_id}/findings/{finding_id}/evidence')
def evidence(run_id: str, finding_id: str):
    finding = next((f for f in app.state.store.run(run_id)['findings'] if f['id'] == finding_id), None)
    if finding is None:
        raise KeyError(finding_id)
    sources = {e['source_id']: app.state.store.source(run_id, e['source_id']) for e in finding['evidence']}
    return materialize_evidence(finding, sources)


@app.patch('/api/runs/{run_id}/findings/{finding_id}/review')
def review(run_id: str, finding_id: str, payload: ReviewInput):
    if scheduled(run_id):
        raise ValueError('Wait until the scheduled run stops before reviewing.')
    return app.state.store.review(run_id, finding_id, payload.status, payload.note)


@app.post('/api/runs/{run_id}/translations')
def translate(run_id: str, payload: TranslationInput):
    if scheduled(run_id):
        raise ValueError('Wait until the scheduled run stops before translating.')
    return translate_saved(app.state.store, run_id, payload.language, app.state.settings)


@app.get('/api/runs/{run_id}/report', response_class=HTMLResponse)
def report(run_id: str, lang: Locale = 'ru', format: Literal['html'] = 'html'):
    return render_report(app.state.store, run_id, lang)


@app.get('/api/runs/{run_id}/functions.csv')
def csv_export(run_id: str):
    return PlainTextResponse(functions_csv(app.state.store, run_id), media_type='text/csv; charset=utf-8',
                             headers={'Content-Disposition': 'attachment; filename="functions.csv"'})
