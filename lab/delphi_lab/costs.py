"""Native lab accounting adapter. All pricing/arithmetic belongs to agent_costs.

No SDK wrapping, requests, prompt logging or retries happen in this module.
"""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path
import re
import sys
import threading
from urllib.parse import urlparse
from uuid import uuid4

from .config import REPO_ROOT

# run.ps1 runs Python from lab/. Also works for uvicorn and direct module use.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

OUTPUT_ROOT = REPO_ROOT / 'agent_costs' / 'out' / 'lab'
PRICES_PATH = REPO_ROOT / 'agent_costs' / 'examples' / 'prices.openai-gpt6-sol.json'
_LOCK = threading.RLock()  # covers separate observers/translation threads, not just Tracker.append
_FAILURES: dict[str, int] = {}


def enabled() -> bool:
    return os.getenv('LAB_COST_TRACKING', '1').strip() != '0'


def warn(message: str) -> None:
    # Even a broken stderr must not replace a successful, paid model result.
    try:
        print(f'[agent_costs] WARNING: {message}', file=sys.stderr)
    except Exception:
        pass


class RunCosts:
    def __init__(self, run_id: str | None):
        self.run_id = run_id
        self.enabled = enabled()
        self.directory: Path | None = None
        self.prices: dict = {}
        self.backend = None
        self.select_prices = None
        self.reservation_id = None
        if not self.enabled:
            return
        if not isinstance(run_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,150}', run_id):
            self.enabled = False
            warn('Missing/invalid saved run_id; accounting unavailable (cost UNKNOWN).')
            return
        self.directory = OUTPUT_ROOT / run_id
        try:
            from agent_costs import cost_tracker
            from agent_costs.lab_run import response_prices
            self.backend, self.select_prices = cost_tracker, response_prices
            self.prices = cost_tracker.load_prices(PRICES_PATH)
        except Exception as exc:
            # Missing tariff is not a reason to interrupt analysis; record UNKNOWN.
            warn(f'Accounting configuration unavailable ({type(exc).__name__}); cost UNKNOWN.')

    def _key(self) -> str:
        return str(self.directory)

    def _fail(self, exc: BaseException) -> None:
        with _LOCK:
            key = self._key()
            _FAILURES[key] = _FAILURES.get(key, 0) + 1
        warn(f'Recording/report update failed ({type(exc).__name__}); accounting incomplete; analysis continues.')

    def _saved_errors(self) -> int:
        try:
            previous = json.loads((self.directory / 'report.json').read_text(encoding='utf-8'))
            return int(previous.get('observer_errors', 0))
        except Exception:
            return 0

    def _budget_state(self) -> dict:
        path = self.directory / 'budget.json'
        if not path.exists():
            return {'run_id': self.run_id, 'pending_reservations': {}}
        return json.loads(path.read_text(encoding='utf-8'))

    def _save_budget(self, state: dict) -> None:
        temporary = self.directory / 'budget.json.tmp'
        self.backend.write_json(temporary, state)
        temporary.replace(self.directory / 'budget.json')

    def check_budget(self, options: dict) -> None:
        """Reserve a conservative per-request ceiling using the existing calculator.

        No new price arithmetic: response_prices/make_event price worst-case token
        usage. Token bound uses full UTF-8 request bytes plus 8192 overhead tokens;
        the maximum supplied output and most expensive configured tier/cache class.
        Reservations survive interruption. Unknown charges stop further requests.
        """
        configured = os.getenv('LAB_COST_BUDGET_USD', '').strip()
        if not configured:
            return
        if not self.enabled or self.backend is None or self.select_prices is None:
            raise ValueError('A monetary budget requires enabled, working cost tracking.')
        try:
            with _LOCK:
                ceiling = self.backend.decimal(configured, 'LAB_COST_BUDGET_USD')
                if ceiling <= 0:
                    raise ValueError('LAB_COST_BUDGET_USD must be positive')
                if _FAILURES.get(self._key(), 0) or self._saved_errors():
                    raise ValueError('Accounting has errors; reconcile costs before another paid request.')
                endpoint = urlparse(os.getenv('OPENAI_BASE_URL') or 'https://api.openai.com/v1')
                if (endpoint.scheme, endpoint.hostname, endpoint.path.rstrip('/')) != ('https', 'api.openai.com', '/v1'):
                    raise ValueError('Budget reservation requires the configured direct OpenAI tariff.')
                event_path = self.directory / 'events.jsonl'
                events = self.backend.read_jsonl(event_path) if event_path.exists() else []
                total = self.backend.summarize(events, run_id=self.run_id)['total']
                if total['unpriced_calls']:
                    raise ValueError('An earlier attempt has UNKNOWN cost; reconcile it before another paid request.')
                if not event_path.exists() and (self.directory / 'report.json').exists():
                    raise ValueError('Cost events are missing; cannot safely resume paid calls.')
                model = options['model']
                rate = self.prices.get('rates', {}).get('openai:' + model)
                if not rate or not rate.get('tier_multipliers'):
                    raise ValueError('No supported tariff for a conservative request reservation.')
                def serialize(value):
                    if hasattr(value, 'model_dump'):
                        return value.model_dump(mode='json')
                    raise TypeError('Unsupported request value for budget reservation')
                byte_count = len(json.dumps(options, ensure_ascii=False, default=serialize).encode('utf-8'))
                input_bound = byte_count + 8192
                output_bound = options['max_output_tokens']
                estimates = []
                for tier in rate['tier_multipliers']:
                    for cache_kind in ('uncached', 'cached_tokens', 'cache_write_tokens'):
                        response = {'model': model, 'service_tier': tier, 'usage': {
                            'input_tokens': input_bound, 'output_tokens': output_bound,
                            'input_tokens_details': {} if cache_kind == 'uncached' else {cache_kind: input_bound}}}
                        prices = self.select_prices(self.prices, response)
                        event = self.backend.make_event(run_id=self.run_id, action='budget_reservation',
                                                       provider='openai', model=model, response=response, prices=prices)
                        if event['cost_usd'] is None:
                            raise ValueError('Cannot price the maximum request; budget guard stopped the run.')
                        estimates.append(self.backend.decimal(event['cost_usd']))
                reserve = max(estimates)
                state = self._budget_state()
                pending = state['pending_reservations']
                held = sum((self.backend.decimal(row['reserved_usd']) for row in pending.values()),
                           self.backend.decimal(0))
                spent = self.backend.decimal(total['known_subtotal_usd'])
                if spent + held + reserve > ceiling:
                    raise ValueError(f'USD budget stop: spent={spent}, reserved={held}, '
                                     f'next_request_ceiling={reserve}, limit={ceiling}. Results retained.')
                reservation_id = uuid4().hex
                pending[reservation_id] = {'reserved_usd': str(reserve), 'model': model,
                                           'created_at': self.backend.now()}
                state['limit_usd'] = str(ceiling)
                self._save_budget(state)  # no paid call when reservation cannot be persisted
                self.reservation_id = reservation_id
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f'Cannot verify/persist spend reservation ({type(exc).__name__}); no paid call sent.') from None

    def _release_reservation(self) -> None:
        if self.reservation_id is None:
            return
        with _LOCK:
            state = self._budget_state()
            state['pending_reservations'].pop(self.reservation_id, None)
            self._save_budget(state)
            self.reservation_id = None

    def _refresh(self) -> dict:
        events_path = self.directory / 'events.jsonl'
        events = self.backend.read_jsonl(events_path) if events_path.exists() else []
        report = self.backend.summarize(events, run_id=self.run_id)
        key = self._key()
        errors = max(_FAILURES.get(key, 0), self._saved_errors())
        _FAILURES[key] = errors
        report['run_id'] = self.run_id
        report['observer_errors'] = errors
        report['total']['cost_complete'] = report['total']['cost_complete'] and not errors
        report['total']['observer_errors'] = errors
        report['total']['accounting_complete'] = not errors
        report['notes'].append('OpenAI snapshot rates selected by agent_costs.lab_run.response_prices; not a billing invoice.')
        # Individual atomic replacements prevent readers observing half a report.
        temporary = self.directory / 'report.json.tmp'
        self.backend.write_json(temporary, report)
        temporary.replace(self.directory / 'report.json')
        csv_temp = self.backend.output_path(self.directory / 'report.csv.tmp')
        groups = [{**group, 'observer_errors': errors, 'accounting_complete': not errors,
                   'cost_complete': group['cost_complete'] and not errors} for group in report['groups']]
        columns = list(groups[0]) if groups else ['run_id', 'action', 'known_subtotal_usd', 'unpriced_calls',
                                                'cost_complete', 'observer_errors', 'accounting_complete']
        with csv_temp.open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            writer.writerows(groups)
        csv_temp.replace(self.directory / 'report.csv')
        return report

    def record(self, stage: str, model: str, response, elapsed_ms: float, *,
               attempt: int, round_index: int, call_index: int, error: BaseException | None = None) -> None:
        if not self.enabled:
            return
        charge_recorded = False
        try:
            with _LOCK:
                key = self._key()
                _FAILURES[key] = max(_FAILURES.get(key, 0), self._saved_errors())
                if self.backend is None or self.select_prices is None:
                    raise RuntimeError('Accounting backend unavailable')
                raw = response.model_dump(mode='json') if hasattr(response, 'model_dump') else (response or {})
                # Only the response metadata/usage allowlist reaches Tracker.
                payload = {key: raw[key] for key in ('id', 'model', 'service_tier', 'status', 'usage') if key in raw}
                endpoint = urlparse(os.getenv('OPENAI_BASE_URL') or 'https://api.openai.com/v1')
                direct = (endpoint.scheme == 'https' and endpoint.hostname == 'api.openai.com'
                          and endpoint.path.rstrip('/') == '/v1')
                prices = self.select_prices(self.prices, payload) if direct else {}
                tracker = self.backend.Tracker(self.directory / 'events.jsonl', self.run_id, prices)
                event = tracker.record(stage, 'openai', model, payload, elapsed_ms=elapsed_ms,
                               attempt=attempt, round_index=round_index, call_index=call_index,
                               status='error' if error is not None else None,
                               error_type=type(error).__name__ if error is not None else None)
                charge_recorded = event['cost_usd'] is not None
                self._refresh()
        except Exception as exc:
            self._fail(exc)
            # A lost event or a report failure is explicitly reflected if storage recovers.
            try:
                with _LOCK:
                    if self.backend is not None:
                        self._refresh()
            except Exception:
                pass
        finally:
            if charge_recorded:
                try:
                    self._release_reservation()
                except Exception as exc:
                    self._fail(exc)

    def snapshot(self) -> dict:
        if not self.enabled:
            return {'enabled': False}
        report_path = self.directory / 'report.json'
        result = {'enabled': True, 'report_json': str(report_path),
                  'report_csv': str(self.directory / 'report.csv'),
                  'events_jsonl': str(self.directory / 'events.jsonl'),
                  'known_subtotal_usd': None, 'cost_complete': False, 'unpriced_calls': None}
        try:
            with _LOCK:
                report = json.loads(report_path.read_text(encoding='utf-8'))
                result.update({k: report['total'][k] for k in ('known_subtotal_usd', 'cost_complete', 'unpriced_calls')})
                errors = max(_FAILURES.get(self._key(), 0), int(report.get('observer_errors', 0)))
                result['observer_errors'] = errors
                result['cost_complete'] = result['cost_complete'] and not errors
        except FileNotFoundError:
            result['observer_errors'] = _FAILURES.get(self._key(), 0)
        except Exception as exc:
            self._fail(exc)
            result['observer_errors'] = _FAILURES.get(self._key(), 0)
            result['cost_complete'] = False
        return result


def print_summary(run_id: str) -> None:
    if not enabled():
        return
    try:
        summary = RunCosts(run_id).snapshot()
        amount = summary.get('known_subtotal_usd')
        known = amount if amount is not None else 'UNKNOWN'
        suffix = '' if summary.get('cost_complete') else ' · TOTAL UNKNOWN / accounting incomplete'
        print(f'[agent_costs] Report: {summary.get("report_json", "unavailable")}\n'
              f'[agent_costs] Known subtotal USD={known}{suffix}; '
              f'unpriced_calls={summary.get("unpriced_calls")}; observer_errors={summary.get("observer_errors", 0)}',
              file=sys.stderr)
    except Exception as exc:
        warn(f'Cannot display cost summary ({type(exc).__name__}); cost UNKNOWN.')
