"""Durable UNKNOWN-cost coverage; fake responses and temporary ledgers only."""
from contextlib import ExitStack, redirect_stderr
from copy import deepcopy
from decimal import Decimal
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

import httpx
from openai import APIConnectionError

from delphi_lab import agent, costs
from test_cost_tracking import ScriptedClient, response


class BudgetRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(costs, 'OUTPUT_ROOT', self.root))
        self.stack.enter_context(patch.dict(os.environ, {
            'OPENAI_API_KEY': 'synthetic-only', 'OPENAI_BASE_URL': 'https://api.openai.com/v1',
            'LAB_COST_TRACKING': '1', 'LAB_COST_BUDGET_USD': '10'}))
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('No network')))
        self.stack.enter_context(patch('openai.OpenAI', side_effect=AssertionError('Use scripted client')))
        self.stack.enter_context(patch.object(agent.time, 'sleep'))
        self.stderr = self.stack.enter_context(redirect_stderr(io.StringIO()))
        self.run_id = 'run_recovery_fake'
        self.folder = self.root / self.run_id

    def observer(self):
        return costs.RunCosts(self.run_id)

    def runner(self, *outcomes):
        runner = agent._Runner([], 'gpt-6-sol', 'en', 40, 5000, 16000, 4, 900, None, run_id=self.run_id)
        runner.client = ScriptedClient(*outcomes)
        return runner

    def request(self, runner):
        return runner.request('risks', {}, agent._Risks)

    def events(self):
        return [json.loads(row) for row in (self.folder / 'events.jsonl').read_text(encoding='utf-8').splitlines()]

    def budget(self):
        return json.loads((self.folder / 'budget.json').read_text(encoding='utf-8'))

    def error(self):
        return APIConnectionError(request=httpx.Request('POST', 'https://api.openai.com/v1/responses'))

    def legacy(self, *, stage='extract', model='gpt-6-sol', round_index=0):
        with patch.dict(os.environ, {'LAB_COST_BUDGET_USD': ''}):
            self.observer().record(stage, model, None, 2.0, attempt=1, round_index=round_index,
                                   call_index=1, error=self.error())
        return self.events()[-1]['event_id']

    def cover(self, identifier):
        return self.observer().reserve_unknown_extraction(identifier, 77353, 5000,
                                                           'Reviewed synthetic historical bound')

    def test_missing_usage_keeps_unknown_cost_but_durable_hold_allows_next_call(self):
        first = self.runner(response('resp_unknown', tokens=None))
        self.assertEqual(self.request(first).findings, [])
        event, = self.events()
        self.assertIsNone(event['cost_usd'])
        state = self.budget()
        self.assertEqual(state['pending_reservations'], {})
        self.assertIn(event['event_id'], state['unknown_reservations'])
        second = self.runner(response('resp_known'))
        self.request(second)
        self.assertEqual(len(second.client.requests), 1)
        snapshot = self.observer().snapshot()
        self.assertFalse(snapshot['cost_complete'])
        self.assertEqual(snapshot['unpriced_calls'], 1)
        self.assertTrue(snapshot['budget']['coverage_complete'])
        self.assertGreater(Decimal(snapshot['budget']['unknown_reserved_usd']), 0)
        self.assertFalse(snapshot['budget']['is_billed_total'])
        self.assertIsNone(self.events()[0]['cost_usd'])

    def test_transient_retry_uses_separate_reservation_without_fabricating_charge(self):
        runner = self.runner(self.error(), response('resp_retry'))
        self.request(runner)
        self.assertEqual(len(runner.client.requests), 2)
        events = self.events()
        self.assertEqual([event['attempt'] for event in events], [1, 2])
        self.assertIsNone(events[0]['cost_usd'])
        self.assertEqual(len(self.budget()['unknown_reservations']), 1)
        self.assertEqual(self.budget()['pending_reservations'], {})

    def test_legacy_unknown_is_blocked_until_exact_reviewed_hold_saved(self):
        identifier = self.legacy()
        blocked = self.runner(response('not_called'))
        with self.assertRaises(agent._Stopped):
            self.request(blocked)
        self.assertEqual(blocked.client.requests, [])
        before = (self.folder / 'events.jsonl').read_bytes()
        row = self.cover(identifier)
        self.assertEqual(Decimal(row['reserved_usd']), Decimal('0.486765'))
        self.assertEqual(before, (self.folder / 'events.jsonl').read_bytes())
        self.assertEqual(row, self.cover(identifier))
        after = self.runner(response('after_legacy_cover'))
        self.request(after)
        self.assertEqual(len(after.client.requests), 1)
        self.assertIsNone(self.events()[0]['cost_usd'])

    def test_covering_one_event_does_not_cover_unrelated_unknown(self):
        first = self.legacy()
        self.cover(first)
        second = self.legacy()
        self.assertNotEqual(first, second)
        runner = self.runner(response('not_called'))
        with self.assertRaises(agent._Stopped):
            self.request(runner)
        self.assertEqual(runner.client.requests, [])
        self.assertEqual(self.observer().snapshot()['budget']['uncovered_unknown_calls'], 1)

    def test_cap_counts_known_cost_legacy_hold_and_pending_reservations(self):
        identifier = self.legacy()
        self.cover(identifier)
        self.observer().record('risks', 'gpt-6-sol', response('known_spend'), 1,
                               attempt=1, round_index=0, call_index=2)
        options = {'model': 'gpt-6-sol', 'input': [], 'max_output_tokens': 5000}
        self.observer().check_budget(options)
        meta = self.observer().snapshot()['budget']
        spent = Decimal(self.observer().snapshot()['known_subtotal_usd'])
        held = Decimal(meta['unknown_reserved_usd'])
        pending = Decimal(meta['pending_reserved_usd'])
        self.assertEqual(Decimal(meta['committed_ceiling_usd']), spent + held + pending)
        with patch.dict(os.environ, {'LAB_COST_BUDGET_USD': str(spent + held + pending * Decimal('1.5'))}):
            with self.assertRaises(ValueError):
                self.observer().check_budget(options)

    def test_invalid_legacy_identity_stage_model_round_and_bounds_are_rejected(self):
        for stage, model, round_index in (('risks', 'gpt-6-sol', 0), ('extract', 'unpriced-model', 0),
                                         ('extract', 'gpt-6-sol', 1)):
            with self.subTest(stage=stage, model=model, round=round_index):
                with self.assertRaises(ValueError):
                    self.cover(self.legacy(stage=stage, model=model, round_index=round_index))
        identifier = self.legacy()
        for inp, out, reason in ((0, 5000, 'reason'), (True, 5000, 'reason'),
                                 (77353, -1, 'reason'), (77353, 5000.5, 'reason'), (77353, 5000, '')):
            with self.subTest(inp=inp, out=out, reason=reason):
                with self.assertRaises(ValueError):
                    self.observer().reserve_unknown_extraction(identifier, inp, out, reason)
        with self.assertRaises(ValueError):
            self.cover('event_not_in_this_run')

    def test_conflicting_hold_rejected_and_reason_text_is_not_logged(self):
        identifier = self.legacy()
        private = 'SYNTHETIC_SECRET_OR_DOCUMENT_CONTENT'
        self.observer().reserve_unknown_extraction(identifier, 77353, 5000, private)
        for path in self.folder.iterdir():
            self.assertNotIn(private, path.read_text(encoding='utf-8-sig'))
        with self.assertRaises(ValueError):
            self.observer().reserve_unknown_extraction(identifier, 1, 5000, 'conflict')

    def test_tampered_budget_fails_closed_before_sdk(self):
        identifier = self.legacy()
        self.cover(identifier)
        original = self.budget()
        mutations = [
            lambda state: state.update(run_id='another_run'),
            lambda state: state['unknown_reservations'][identifier].update(reserved_usd='NaN'),
            lambda state: state['unknown_reservations'][identifier].update(reserved_usd='Infinity'),
            lambda state: state['unknown_reservations'][identifier].update(reserved_usd='-1'),
            lambda state: state['unknown_reservations'][identifier].update(reserved_usd='0.000001'),
            lambda state: state['unknown_reservations'][identifier].update(input_token_bound=True),
            lambda state: state['unknown_reservations'][identifier].update(event_signature='wrong'),
            lambda state: state['unknown_reservations'][identifier].update(event_id='foreign'),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                state = deepcopy(original)
                mutate(state)
                (self.folder / 'budget.json').write_text(json.dumps(state), encoding='utf-8')
                runner = self.runner(response('not_called'))
                with self.assertRaises(agent._Stopped):
                    self.request(runner)
                self.assertEqual(runner.client.requests, [])

    def test_reservation_write_failure_prevents_sdk(self):
        runner = self.runner(response('not_called'))
        with patch.object(runner.costs, '_save_budget', side_effect=OSError('Synthetic disk failure')):
            with self.assertRaises(agent._Stopped):
                self.request(runner)
        self.assertEqual(runner.client.requests, [])

    def test_unknown_settlement_failure_preserves_response_and_blocks_future_calls(self):
        runner = self.runner(response('unknown_saved', tokens=None), response('not_called'))
        original = runner.costs._save_budget
        calls = 0

        def fail_second_save(state):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('Synthetic settlement failure')
            return original(state)

        with patch.object(runner.costs, '_save_budget', side_effect=fail_second_save):
            self.assertEqual(self.request(runner).findings, [])
        self.assertEqual(len(runner.client.requests), 1)
        self.assertIsNone(self.events()[0]['cost_usd'])
        self.assertEqual(len(self.budget()['pending_reservations']), 1)
        with self.assertRaises(agent._Stopped):
            self.request(runner)
        self.assertEqual(len(runner.client.requests), 1)


if __name__ == '__main__':
    unittest.main()
