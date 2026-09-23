from pathlib import Path
import tempfile

from .config import Settings, require_live_config
from .models import AgentResult, Finding
from .storage import Store, uid, now
from .validation import validate_result


def upload_bytes(store: Store, analysis_id: str, filename: str, side: str, content: bytes) -> dict:
    from .parsers import parse_document
    # User filenames are labels only; never use them as storage paths.
    filename = Path(filename.replace('\\', '/')).name
    suffix = Path(filename).suffix.lower()
    if len(content) > 20 * 1024 * 1024:
        raise ValueError('File exceeds 20 MiB upload limit')
    staging = store.root / 'staging'
    staging.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=staging) as directory:
        path = Path(directory) / f'input{suffix}'
        path.write_bytes(content)
        doc = parse_document(path, side, document_id=uid('doc'))
        doc.filename = filename
        if doc.parse_status == 'error' or not doc.blocks:
            raise ValueError(f'{filename}: document has no usable text; {doc.warnings}')
        store.add_document(analysis_id, doc, content)
    payload = doc.model_dump()
    payload['block_count'] = len(payload.pop('blocks'))
    return payload


def upload_paths(store: Store, analysis_id: str, side: str, paths: list[Path]) -> list[dict]:
    result = []
    for path in paths:
        if path.stat().st_size > 20 * 1024 * 1024:
            raise ValueError(f'{path.name}: file exceeds 20 MiB')
        result.append(upload_bytes(store, analysis_id, path.name, side, path.read_bytes()))
    return result


def execute_run(store: Store, run_id: str, settings: Settings, *, resume: bool = False) -> dict:
    from .diffing import compare_documents
    run = store.run(run_id)
    if not resume and run['state'] != 'queued':
        return run
    documents = store.documents(run_id)
    resume_result = None
    if resume:
        if run['state'] not in {'partial', 'failed', 'interrupted'} or run['mode'] != 'live':
            raise ValueError('Only a stopped partial, failed or interrupted live run can be resumed.')
        if run['model'] != settings.model:
            raise ValueError('A resumed run must use its original model; restore OPENAI_MODEL.')
        if run.get('immutable_document_ids') != [doc.id for doc in documents]:
            raise ValueError('Saved immutable document IDs do not match the documents for this run.')
        if any(item['state'] in {'queued', 'running'} for item in store.list_analyses()):
            raise ValueError('Another lab run is active; wait until it stops before resuming.')
        require_live_config(run['model'])
        fields = set(AgentResult.model_fields) - {'complete'}
        snapshot = {key: value for key, value in run.items() if key in fields}
        prefix = f'{run_id}__'
        snapshot['findings'] = [
            {**{key: value for key, value in finding.items() if key in Finding.model_fields},
             'id': finding['id'].removeprefix(prefix)} for finding in run['findings']
        ]
        resume_result = AgentResult.model_validate(snapshot)
        validate_result(resume_result, documents)
        # Saved translations are keyed by this revision. Resumed work may add
        # findings, so the old translated snapshot must not be returned as current.
        run['review_revision'] += 1
    run.update(state='running', stage='resuming' if resume else 'diff', finished_at=None)
    store.save_run(run)
    try:
        if not resume or not run['diff']:
            run['diff'] = compare_documents(documents)
        if not resume:
            run['coverage'] = {'documents': len(documents), 'source_blocks': sum(len(d.blocks) for d in documents),
                               'semantic_analysis': False, 'diff_complete': run['diff'].get('complete', True),
                               'unprocessed_diff_source_ids': run['diff'].get('unprocessed_before_source_ids', [])}
        if not run['diff'].get('complete', True):
            run['limitations'].append('Text comparison stopped at its time/block limit; see unprocessed_diff_source_ids.')
        store.save_run(run)
        if run['mode'] == 'preprocess':
            run.update(state='prepared' if run['diff'].get('complete', True) else 'partial', stage='prepared')
            run['limitations'].append('Preprocessing only: no model called; no semantic findings or absence-of-risk claim.')
        else:
            from .agent import run_agent
            require_live_config(run['model'])

            def save_progress(progress: dict) -> None:
                snapshot = AgentResult.model_validate(progress['result'])
                validate_result(snapshot, documents)
                run.update(snapshot.model_dump(exclude={'complete'}))
                run['coverage']['diff_complete'] = run['diff'].get('complete', True)
                run['coverage']['unprocessed_diff_source_ids'] = run['diff'].get('unprocessed_before_source_ids', [])
                run.update(stage=progress['stage'], state='running')
                # Namespace finding IDs so independent runs cannot overwrite each other.
                run['findings'] = [{**f, 'id': f'{run_id}__{f["id"]}'} for f in run['findings']]
                store.save_run(run)

            resume_options = {'resume_result': resume_result} if resume else {}
            result = run_agent(documents, model=run['model'], language=run['output_language'],
                               max_calls=settings.max_calls, max_output_tokens=settings.max_output_tokens,
                               max_input_chars=settings.max_input_chars, max_tool_rounds=settings.max_tool_rounds,
                               timeout_seconds=settings.timeout_seconds, on_progress=save_progress, run_id=run_id,
                               **resume_options)
            validate_result(result, documents)
            run.update(result.model_dump(exclude={'complete'}))
            run['coverage']['diff_complete'] = run['diff'].get('complete', True)
            run['coverage']['unprocessed_diff_source_ids'] = run['diff'].get('unprocessed_before_source_ids', [])
            run['findings'] = [{**f, 'id': f'{run_id}__{f["id"]}'} for f in run['findings']]
            run.update(state='completed' if result.complete and run['diff'].get('complete', True) else 'partial', stage='finished')
    except Exception as exc:
        # SDK errors are sanitized inside the agent; do not save auth headers or request bodies here.
        message = str(exc) if isinstance(exc, (ValueError, KeyError)) else type(exc).__name__
        run['errors'].append(message)
        run.update(state='partial' if run.get('functions') else 'failed', stage='stopped')
    run['finished_at'] = now()
    store.save_run(run)
    return store.run(run_id)


def translate_saved(store: Store, run_id: str, locale: str, settings: Settings) -> dict:
    run = store.run(run_id)
    if run['state'] in {'queued', 'running'}:
        raise ValueError('Wait until the run stops before translating.')
    cached = store.translation(run_id, run['review_revision'], locale)
    if cached:
        return cached
    if locale == run['output_language']:
        payload = {'locale': locale, 'findings': [
            {k: f[k] for k in ('id', 'title', 'explanation', 'recommendation')} for f in run['findings']]}
    elif not run['findings']:
        payload = {'locale': locale, 'findings': []}
    else:
        from .agent import translate_result
        require_live_config(settings.model)
        allowed = Finding.model_fields
        result = AgentResult(findings=[Finding.model_validate({k: v for k, v in f.items() if k in allowed})
                                      for f in run['findings']])
        payload = translate_result(result, locale, settings.model, run_id=run_id)
        if {f['id'] for f in payload['findings']} != {f['id'] for f in run['findings']}:
            raise ValueError('Translation changed finding IDs')
    store.save_translation(run_id, run['review_revision'], locale, payload)
    return payload
