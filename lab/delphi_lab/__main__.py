import argparse
from dataclasses import replace
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import sys

from .config import LAB_ROOT, REPO_ROOT, Settings, require_live_config
from .pipeline import upload_paths, execute_run, translate_saved
from .reports import render_report, functions_csv
from .runtime import RuntimeLock
from .storage import Store
from .costs import print_summary


def dump(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def export(store: Store, run_id: str, lang: str) -> dict:
    directory = store.root / 'runs' / run_id
    directory.mkdir(parents=True, exist_ok=True)
    run = store.run(run_id)
    (directory / 'result.json').write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding='utf-8')
    (directory / 'sources.json').write_text(json.dumps([d.model_dump() for d in store.documents(run_id)],
                                                     ensure_ascii=False, indent=2), encoding='utf-8')
    report = directory / f'report.{lang}.html'
    report.write_text(render_report(store, run_id, lang, run), encoding='utf-8')
    (directory / 'functions.csv').write_text(functions_csv(store, run_id, run), encoding='utf-8')
    return {'run_id': run_id, 'state': run['state'], 'mode': run['mode'], 'report': str(report),
            'result': str(directory / 'result.json'), 'findings': len(run['findings']),
            'coverage': run['coverage'], 'errors': run['errors']}


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Delphi lab. Analysis data: lab/data; costs: agent_costs/out/lab.')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('demo', 'analyze'):
        command = sub.add_parser(name)
        command.add_argument('--mode', choices=['preprocess', 'live'], default='preprocess')
        command.add_argument('--language', choices=['ru', 'kk', 'en'], default='ru')
        command.add_argument('--title', default='Lab comparison')
        command.add_argument('--allow-limited', action='store_true', help='Acknowledge parsing warnings')
        if name == 'demo':
            command.add_argument('--fixture', choices=['real', 'ru', 'kk', 'en'], default='real')
        else:
            command.add_argument('--before', nargs='+', type=Path, required=True)
            command.add_argument('--after', nargs='+', type=Path, required=True)
    parse = sub.add_parser('parse')
    parse.add_argument('file', type=Path)
    parse.add_argument('--side', choices=['before', 'after'], default='before')
    sub.add_parser('history')
    sub.add_parser('recover', help='Mark a stopped process interrupted; use only when no server/run is active')
    resume = sub.add_parser('resume', help='Resume accepted work in a stopped live run without re-extracting completed blocks')
    resume.add_argument('run_id')
    resume.add_argument('--max-calls', type=int, help='Total API call ceiling including earlier attempts in this run')
    resume.add_argument('--timeout-seconds', type=int, help='Time allowance for this resumption only')
    resume.add_argument('--cost-budget-usd', help='Cumulative USD ceiling for this run, including its earlier API calls')
    for name in ('show', 'export', 'translate', 'review'):
        command = sub.add_parser(name)
        command.add_argument('run_id')
        if name in ('export', 'translate'):
            command.add_argument('--language', choices=['ru', 'kk', 'en'], default='ru')
        if name == 'review':
            command.add_argument('finding_id')
            command.add_argument('status', choices=['confirmed', 'needs_clarification', 'rejected', 'unreviewed'])
            command.add_argument('--note', default='')
    serve = sub.add_parser('serve')
    serve.add_argument('--port', type=int, default=8010)
    args = parser.parse_args()
    settings = Settings()
    lock = RuntimeLock()
    cost_run_id = None
    previous_cost_budget = os.environ.get('LAB_COST_BUDGET_USD')
    changed_cost_budget = False
    try:
        if args.command == 'serve':
            import uvicorn
            uvicorn.run('delphi_lab.api:app', host='127.0.0.1', port=args.port, workers=1)
            return 0
        lock.acquire()
        if args.command == 'parse':
            from .parsers import parse_document
            dump(parse_document(args.file, args.side).model_dump())
            return 0
        store = Store()
        if args.command == 'history':
            dump(store.list_analyses())
        elif args.command == 'recover':
            dump({'interrupted_runs': store.recover_interrupted()})
        elif args.command == 'show':
            dump(store.run(args.run_id))
        elif args.command == 'export':
            dump(export(store, args.run_id, args.language))
        elif args.command == 'review':
            dump(store.review(args.run_id, args.finding_id, args.status, args.note))
        elif args.command == 'translate':
            cost_run_id = args.run_id
            dump(translate_saved(store, args.run_id, args.language, settings))
        elif args.command == 'resume':
            limits = {}
            for name in ('max_calls', 'timeout_seconds'):
                value = getattr(args, name)
                if value is not None:
                    if value <= 0:
                        raise ValueError(f'{name} must be positive')
                    limits[name] = value
            settings = replace(settings, **limits)
            if args.cost_budget_usd is not None:
                try:
                    ceiling = Decimal(args.cost_budget_usd)
                    if not ceiling.is_finite() or ceiling <= 0:
                        raise InvalidOperation
                except InvalidOperation:
                    raise ValueError('--cost-budget-usd must be a positive finite USD amount') from None
                os.environ['LAB_COST_BUDGET_USD'] = str(ceiling)
                changed_cost_budget = True
            cost_run_id = args.run_id
            run = execute_run(store, args.run_id, settings, resume=True)
            result = export(store, args.run_id, run['output_language'])
            dump(result)
            return 0 if result['state'] == 'completed' else 2
        else:
            if args.mode == 'live':
                require_live_config(settings.model)
            if args.command == 'demo':
                if args.fixture == 'real':
                    before = [next((REPO_ROOT / 'docs/sources').glob('*8*.docx'))]
                    after = [next((REPO_ROOT / 'docs/hackaton/tracks').glob('*9*.docx.md'))]
                else:
                    folder = LAB_ROOT / 'fixtures/synthetic' / args.fixture
                    before, after = [folder / 'before.md'], [folder / 'after.md']
            else:
                before, after = args.before, args.after
            analysis = store.create_analysis(args.title)
            uploaded = upload_paths(store, analysis['id'], 'before', before)
            uploaded += upload_paths(store, analysis['id'], 'after', after)
            print(json.dumps({'analysis_id': analysis['id'], 'documents': uploaded}, ensure_ascii=False), file=sys.stderr)
            run = store.start(analysis['id'], args.mode, args.language, settings.model, args.allow_limited)
            if args.mode == 'live':
                cost_run_id = run['id']
            execute_run(store, run['id'], settings)
            result = export(store, run['id'], args.language)
            dump(result)
            return 0 if result['state'] in {'prepared', 'completed'} else 2
        return 0
    except (ValueError, KeyError, OSError, StopIteration) as exc:
        print(f'Lab: {exc}', file=sys.stderr)
        return 1
    finally:
        lock.release()
        if cost_run_id is not None:
            print_summary(cost_run_id)
        if changed_cost_budget:
            if previous_cost_budget is None:
                os.environ.pop('LAB_COST_BUDGET_USD', None)
            else:
                os.environ['LAB_COST_BUDGET_USD'] = previous_cost_budget


if __name__ == '__main__':
    raise SystemExit(main())
