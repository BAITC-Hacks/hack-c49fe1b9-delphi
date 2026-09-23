"""Native lab accounting adapter. All pricing/arithmetic belongs to agent_costs.

No SDK wrapping, requests, prompt logging or retries happen in this module.
"""
from __future__ import annotations

import csv
from hashlib import sha256
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
            value = previous.get('observer_errors', 0)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError('Invalid accounting error counter')
            return value
        except FileNotFoundError:
            return 0
        except Exception:
            return 1  # A damaged accounting report must not permit more paid calls.

    def _require_accounting(self) -> None:
        if not self.enabled or self.backend is None or self.select_prices is None:
            raise ValueError('A monetary budget requires enabled, working cost tracking.')
        endpoint = urlparse(os.getenv('OPENAI_BASE_URL') or 'https://api.openai.com/v1')
        if (endpoint.scheme, endpoint.hostname, endpoint.path.rstrip('/')) != ('https', 'api.openai.com', '/v1'):
            raise ValueError('Budget reservation requires the configured direct OpenAI tariff.')

    def _positive(self, value, name: str):
        if isinstance(value, bool):
            raise ValueError(f'{name} must be positive and finite')
        result = self.backend.decimal(value, name)
        if result <= 0:
            raise ValueError(f'{name} must be positive and finite')
        return result

    def _worst_case(self, model: str, input_bound: int, output_bound: int):
        """Price bounds only through the existing agent_costs calculator."""
        for value in (input_bound, output_bound):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError('Token bounds must be positive integers')
        if not isinstance(model, str) or not model:
            raise ValueError('A recognized model is required')
        rate = self.prices.get('rates', {}).get('openai:' + model)
        if not rate or not rate.get('tier_multipliers'):
            raise ValueError('No supported tariff for a conservative request reservation.')
        estimates = []
        for tier in rate['tier_multipliers']:
            for cache_kind in ('uncached', 'cached_tokens', 'cache_write_tokens'):
                reply = {'model': model, 'service_tier': tier, 'usage': {
                    'input_tokens': input_bound, 'output_tokens': output_bound,
                    'input_tokens_details': {} if cache_kind == 'uncached' else {cache_kind: input_bound}}}
                event = self.backend.make_event(
                    run_id=self.run_id, action='budget_reservation', provider='openai', model=model,
                    response=reply, prices=self.select_prices(self.prices, reply))
                if event['cost_usd'] is None:
                    raise ValueError('Cannot price the maximum request; no paid call sent.')
                estimates.append(self.backend.decimal(event['cost_usd']))
        return max(estimates)

    def _events(self) -> list[dict]:
        path = self.directory / 'events.jsonl'
        if not path.exists():
            if (self.directory / 'report.json').exists():
                raise ValueError('Cost events are missing; cannot safely resume paid calls.')
            return []
        events = self.backend.read_jsonl(path)
        ids = set()
        for event in events:
            identifier = event.get('event_id')
            if event.get('run_id') != self.run_id or not isinstance(identifier, str) or not identifier or identifier in ids:
                raise ValueError('Accounting events have foreign, missing or repeated identities')
            ids.add(identifier)
        return events

    @staticmethod
    def _event_signature(event: dict) -> str:
        # Hash identity/usage metadata, never persist SDK request or response text.
        fields = ('event_id', 'run_id', 'action', 'provider', 'requested_model', 'model',
                  'round_index', 'call_index', 'attempt', 'status', 'response_id', 'error_type',
                  'service_tier', 'cost_usd', 'raw_usage')
        data = {key: event.get(key) for key in fields}
        return sha256(json.dumps(data, sort_keys=True, default=str).encode('utf-8')).hexdigest()

    def _validate_unknown(self, event: dict, row: dict) -> None:
        if (event.get('run_id') != self.run_id or event.get('provider') != 'openai'
                or event.get('cost_usd') is not None or event.get('requested_model') != row['model']
                or event.get('model') != row['model']):
            raise ValueError('Unknown-cost hold does not match its original attempt')
        if event.get('service_tier') not in (None, *self.prices['rates']['openai:' + row['model']]['tier_multipliers']):
            raise ValueError('Unknown service tier cannot be covered by configured prices')
        for name, minimum in (('attempt', 1), ('call_index', 1), ('round_index', 0)):
            value = event.get(name)
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
                raise ValueError('Unknown attempt has invalid call/round metadata')
        raw = event.get('raw_usage') or {}
        if not isinstance(raw, dict):
            raise ValueError('Invalid saved usage for an unknown-cost attempt')
        for key, bound in (('input_tokens', row['input_token_bound']), ('output_tokens', row['output_token_bound'])):
            actual = raw.get(key)
            if actual is not None and (isinstance(actual, bool) or not isinstance(actual, int) or actual < 0 or actual > bound):
                raise ValueError('Reported usage exceeds or invalidates the reserved token bounds')

    def _budget_state(self) -> dict:
        path = self.directory / 'budget.json'
        if not path.exists():
            return {'schema_version': 2, 'run_id': self.run_id, 'pending_reservations': {}, 'unknown_reservations': {}}
        state = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(state, dict) or state.get('run_id') != self.run_id:
            raise ValueError('Budget state belongs to another run or is invalid')
        if state.get('schema_version', 2) != 2:
            raise ValueError('Unsupported budget state version')
        state.setdefault('unknown_reservations', {})
        if 'limit_usd' in state:
            self._positive(state['limit_usd'], 'limit_usd')
        events = {event['event_id']: event for event in self._events()}
        for name in ('pending_reservations', 'unknown_reservations'):
            rows = state.get(name)
            if not isinstance(rows, dict):
                raise ValueError('Invalid reservation registry')
            for identifier, row in rows.items():
                if not isinstance(identifier, str) or not identifier or not isinstance(row, dict):
                    raise ValueError('Invalid reservation identity')
                minimum = self._worst_case(row['model'], row['input_token_bound'], row['output_token_bound'])
                if self._positive(row['reserved_usd'], 'reserved_usd') < minimum:
                    raise ValueError('Reservation is smaller than its priced token bounds')
                if name == 'unknown_reservations':
                    event = events.get(identifier)
                    if event is None or row.get('event_id') != identifier:
                        raise ValueError('Unknown-cost hold references a missing event')
                    self._validate_unknown(event, row)
                    if row.get('event_signature') != self._event_signature(event):
                        raise ValueError('Unknown-cost hold metadata changed after reservation')
                    if row.get('basis') == 'legacy_unknown_upper_bound_not_billed':
                        if event.get('action') != 'extract' or event.get('round_index') != 0 or event.get('status') != 'error':
                            raise ValueError('Legacy hold must cover an initial extraction error')
                    elif row.get('basis') != 'attempt_upper_bound_not_billed':
                        raise ValueError('Unknown reservation basis')
        return state

    def _save_budget(self, state: dict) -> None:
        temporary = self.directory / 'budget.json.tmp'
        self.backend.write_json(temporary, state)
        temporary.replace(self.directory / 'budget.json')

    def _budget_metadata(self, events: list[dict] | None = None, state: dict | None = None) -> dict:
        events = self._events() if events is None else events
        state = self._budget_state() if state is None else state
        total = self.backend.summarize(events, run_id=self.run_id)['total']
        pending = sum((self.backend.decimal(row['reserved_usd']) for row in state['pending_reservations'].values()), self.backend.decimal(0))
        held = sum((self.backend.decimal(row['reserved_usd']) for row in state['unknown_reservations'].values()), self.backend.decimal(0))
        unknown = {event['event_id'] for event in events if event.get('cost_usd') is None}
        covered = unknown & set(state['unknown_reservations'])
        spent = self.backend.decimal(total['known_subtotal_usd'])
        return {'limit_usd': state.get('limit_usd'), 'pending_reserved_usd': str(pending),
                'unknown_reserved_usd': str(held), 'committed_ceiling_usd': str(spent + pending + held),
                'pending_attempts': len(state['pending_reservations']), 'covered_unknown_calls': len(covered),
                'uncovered_unknown_calls': len(unknown - covered), 'coverage_complete': unknown == covered,
                'is_billed_total': False}

    def reserve_unknown_extraction(self, event_id: str, input_bound: int, output_bound: int, reason: str) -> dict:
        """Explicit reviewed legacy bound; never rewrites an UNKNOWN event as billed.

        The caller must establish the historical token bounds independently. Only
        a hash of the supplied reason is saved, to avoid copying secrets or text.
        """
        self._require_accounting()
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
            raise ValueError('A bounded, nonempty review reason is required')
        with _LOCK:
            events = self._events()
            event = next((item for item in events if item['event_id'] == event_id), None)
            if event is None or event.get('action') != 'extract' or event.get('round_index') != 0 or event.get('status') != 'error':
                raise ValueError('Legacy hold requires an exact initial extraction error in this run')
            model = event.get('requested_model')
            reserve = self._worst_case(model, input_bound, output_bound)
            row = {'event_id': event_id, 'model': model, 'input_token_bound': input_bound,
                   'output_token_bound': output_bound, 'reserved_usd': str(reserve),
                   'event_signature': self._event_signature(event), 'created_at': self.backend.now(),
                   'basis': 'legacy_unknown_upper_bound_not_billed',
                   'reason_sha256': sha256(reason.encode('utf-8')).hexdigest()}
            self._validate_unknown(event, row)
            state = self._budget_state()
            previous = state['unknown_reservations'].get(event_id)
            if previous is not None:
                if any(previous.get(key) != row[key] for key in ('model', 'input_token_bound', 'output_token_bound', 'basis', 'event_signature')):
                    raise ValueError('This event already has a different reservation')
                return previous.copy()
            state['unknown_reservations'][event_id] = row
            configured = os.getenv('LAB_COST_BUDGET_USD', '').strip()
            if configured:
                ceiling = self._positive(configured, 'LAB_COST_BUDGET_USD')
                if self.backend.decimal(self._budget_metadata(events, state)['committed_ceiling_usd']) > ceiling:
                    raise ValueError('Legacy reservation exceeds the configured total budget')
                state['limit_usd'] = str(ceiling)
            self._save_budget(state)
            try:
                self._refresh()
            except Exception as exc:
                self._fail(exc)
            return row.copy()

    def check_budget(self, options: dict) -> None:
        """Reserve a conservative per-request ceiling using the existing calculator.

        No new price arithmetic: response_prices/make_event price worst-case token
        usage. Token bound uses full UTF-8 request bytes plus 8192 overhead tokens;
        the maximum supplied output and most expensive configured tier/cache class.
        Reservations survive interruption. Uncovered unknown charges stop calls.
        """
        configured = os.getenv('LAB_COST_BUDGET_USD', '').strip()
        if not configured:
            return
        self._require_accounting()
        try:
            with _LOCK:
                ceiling = self._positive(configured, 'LAB_COST_BUDGET_USD')
                if self.reservation_id is not None:
                    raise ValueError('The previous request reservation has not been settled')
                if _FAILURES.get(self._key(), 0) or self._saved_errors():
                    raise ValueError('Accounting has errors; reconcile costs before another paid request.')
                events = self._events()
                total = self.backend.summarize(events, run_id=self.run_id)['total']
                state = self._budget_state()
                metadata = self._budget_metadata(events, state)
                if not metadata['coverage_complete']:
                    raise ValueError('An earlier attempt has uncovered UNKNOWN cost; review its bound before another paid request.')
                model = options['model']
                def serialize(value):
                    if hasattr(value, 'model_dump'):
                        return value.model_dump(mode='json')
                    raise TypeError('Unsupported request value for budget reservation')
                byte_count = len(json.dumps(options, ensure_ascii=False, default=serialize).encode('utf-8'))
                input_bound = byte_count + 8192
                output_bound = options['max_output_tokens']
                reserve = self._worst_case(model, input_bound, output_bound)
                pending = state['pending_reservations']
                held = self.backend.decimal(metadata['pending_reserved_usd']) + self.backend.decimal(metadata['unknown_reserved_usd'])
                spent = self.backend.decimal(total['known_subtotal_usd'])
                if spent + held + reserve > ceiling:
                    raise ValueError(f'USD budget stop: spent={spent}, reserved={held}, '
                                     f'next_request_ceiling={reserve}, limit={ceiling}. Results retained.')
                reservation_id = uuid4().hex
                pending[reservation_id] = {'reserved_usd': str(reserve), 'model': model,
                                           'input_token_bound': input_bound, 'output_token_bound': output_bound,
                                           'created_at': self.backend.now()}
                state['limit_usd'] = str(ceiling)
                self._save_budget(state)  # no paid call when reservation cannot be persisted
                self.reservation_id = reservation_id
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f'Cannot verify/persist spend reservation ({type(exc).__name__}); no paid call sent.') from None

    def _settle_reservation(self, event: dict) -> None:
        if self.reservation_id is None:
            return
        with _LOCK:
            state = self._budget_state()
            row = state['pending_reservations'].get(self.reservation_id)
            if row is None:
                raise ValueError('Request reservation disappeared before settlement')
            if event['cost_usd'] is None:
                self._validate_unknown(event, row)
                state['unknown_reservations'][event['event_id']] = {
                    **row, 'event_id': event['event_id'], 'reservation_id': self.reservation_id,
                    'event_signature': self._event_signature(event), 'basis': 'attempt_upper_bound_not_billed'}
            state['pending_reservations'].pop(self.reservation_id)
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
        report['budget'] = self._budget_metadata(events)
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
                self._settle_reservation(event)
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
                result['budget'] = self._budget_metadata()
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
        if 'budget' in summary:
            budget = summary['budget']
            print(f'[agent_costs] Budget holds (not billed): unknown USD={budget["unknown_reserved_usd"]}; '
                  f'pending USD={budget["pending_reserved_usd"]}; committed ceiling USD={budget["committed_ceiling_usd"]}; '
                  f'uncovered unknown calls={budget["uncovered_unknown_calls"]}', file=sys.stderr)
    except Exception as exc:
        warn(f'Cannot display cost summary ({type(exc).__name__}); cost UNKNOWN.')
