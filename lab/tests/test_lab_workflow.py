"""Local database/API/report acceptance with fake agents and no external network."""
from contextlib import ExitStack
from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from delphi_lab import agent, api, costs, pipeline, storage
from delphi_lab.config import Settings
from delphi_lab.models import AgentResult, Evidence, Finding, Function, Unit
from delphi_lab.planning import estimate
from delphi_lab.reports import render_report, localized_run


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(storage, 'data_dir', return_value=self.root))
        from delphi_lab import runtime
        self.stack.enter_context(patch.object(runtime, 'data_dir', return_value=self.root))
        self.stack.enter_context(patch.object(costs, 'OUTPUT_ROOT', self.root / 'costs'))
        self.stack.enter_context(patch.dict(os.environ, {'OPENAI_API_KEY': 'fake-workflow-key',
                                                        'LAB_COST_BUDGET_USD': '', 'LAB_COST_TRACKING': '1'}))
        original_connect = socket.socket.connect
        def local_only(sock, address):
            if not isinstance(address, tuple) or address[0] not in {'127.0.0.1', '::1'}:
                raise AssertionError('No external network in workflow tests')
            return original_connect(sock, address)
        self.stack.enter_context(patch.object(socket.socket, 'connect', local_only))
        self.stack.enter_context(patch('openai.OpenAI', side_effect=AssertionError('Unexpected live SDK')))
        self.store = storage.Store()
        self.settings = Settings(model='gpt-6-sol')

    def new_run(self):
        analysis = self.store.create_analysis('Synthetic workflow acceptance')
        for side, owner in [('before', 'Old unit'), ('after', 'New unit')]:
            pipeline.upload_bytes(self.store, analysis['id'], f'{side}.md', side,
                                  f'1. {owner} must approve the synthetic risk report.'.encode())
        return self.store.start(analysis['id'], 'live', 'ru', self.settings.model, True)

    def result(self, documents):
        before, after = [document.blocks[0] for document in documents]
        units = [Unit(id='u_' + block.side, side=block.side, kind='unit',
                      name_original='Synthetic ' + block.side, source_ids=[block.id])
                 for block in (before, after)]
        functions = [Function(id='fn_' + block.side, side=block.side, owner_unit_ids=['u_' + block.side],
                              actor_original='Synthetic ' + block.side, action='Approve', object='risk report',
                              scope='company', condition='', modality='must', source_ids=[block.id])
                     for block in (before, after)]
        return AgentResult(units=units, functions=functions, findings=[Finding(
            id='f_transfer', title='Synthetic transfer <script>alert(1)</script>',
            change_type='transferred', issue_type='scope_changed',
            before_function_ids=['fn_before'], after_function_ids=['fn_after'],
            explanation='Synthetic transfer explanation', recommendation='Synthetic verify the owner',
            evidence=[Evidence(source_id=before.id, evidence_role='before'),
                      Evidence(source_id=after.id, evidence_role='after')])],
            structure=[{'id': 's_transfer', 'before_unit_ids': ['u_before'], 'after_unit_ids': ['u_after'],
                        'status': 'transformed', 'source_ids': [before.id, after.id],
                        'explanation': 'Synthetic structure explanation'}],
            coverage={'blocks_total': 2, 'blocks_processed': 2, 'unprocessed_source_ids': []},
            complete=True)

    def fake_agent(self, documents, **kwargs):
        result = self.result(documents)
        kwargs['on_progress']({'stage': 'compare', 'result': result.model_dump(mode='json')})
        saved = self.store.run(kwargs['run_id'])
        self.assertEqual(len(saved['functions']), 2)
        self.assertEqual(len(saved['structure']), 1)
        return result

    def finish(self):
        run = self.new_run()
        with patch.object(agent, 'run_agent', side_effect=self.fake_agent):
            return pipeline.execute_run(self.store, run['id'], self.settings)

    def test_checkpoint_report_review_and_reopen_use_saved_result(self):
        run = self.finish()
        self.assertEqual(run['state'], 'completed')
        finding_id = run['findings'][0]['id']
        note = '  Synthetic note\nwith original whitespace  '
        first = self.store.review(run['id'], finding_id, 'confirmed', note)
        same = self.store.review(run['id'], finding_id, 'confirmed', note)
        self.assertEqual(first['review_revision'], same['review_revision'])
        reopened = storage.Store().run(run['id'])
        self.assertEqual(reopened['findings'][0]['review']['note'], note)
        html = render_report(self.store, run['id'])
        self.assertIn('Synthetic structure explanation', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertNotIn('<script>alert(1)</script>', html)
        self.assertIn(note, html)
        self.assertIn(run['findings'][0]['evidence'][0]['source_id'], html)

    def test_translation_includes_structure_preserves_sources_and_rejects_bad_ids(self):
        run = self.finish()
        original = deepcopy(run)
        def translate(result, locale, model, *, run_id):
            self.assertEqual(result.structure[0].explanation, 'Synthetic structure explanation')
            return {'locale': locale, 'findings': [{'id': result.findings[0].id, 'title': 'EN title',
                    'explanation': 'EN explanation', 'recommendation': 'EN recommendation'}],
                    'structure': [{'id': result.structure[0].id, 'explanation': 'EN structure'}]}
        with patch.object(agent, 'translate_result', side_effect=translate) as call:
            pipeline.translate_saved(self.store, run['id'], 'en', self.settings)
            pipeline.translate_saved(self.store, run['id'], 'en', self.settings)
            self.assertEqual(call.call_count, 1)
        local = localized_run(self.store, run['id'], 'en')
        self.assertEqual(local['structure'][0]['explanation'], 'EN structure')
        self.assertEqual(local['findings'][0]['evidence'], original['findings'][0]['evidence'])
        self.store.review(run['id'], run['findings'][0]['id'], 'needs_clarification', 'Review changed')
        with self.assertRaises(ValueError):
            localized_run(self.store, run['id'], 'en')
        with self.assertRaises(ValueError):
            self.store.save_translation(run['id'], 1, 'en', {'locale': 'en', 'findings': [], 'structure': []})

    def test_review_change_during_translation_cannot_cache_old_revision(self):
        run = self.finish()
        def translate(result, locale, model, *, run_id):
            self.store.review(run_id, run['findings'][0]['id'], 'confirmed', 'New decision')
            return {'locale': locale, 'findings': [{'id': result.findings[0].id, 'title': 'T',
                    'explanation': 'E', 'recommendation': 'R'}],
                    'structure': [{'id': result.structure[0].id, 'explanation': 'S'}]}
        with patch.object(agent, 'translate_result', side_effect=translate):
            with self.assertRaisesRegex(ValueError, 'Review changed'):
                pipeline.translate_saved(self.store, run['id'], 'en', self.settings)
        self.assertIsNone(self.store.translation(run['id'], 0, 'en'))

    def test_start_is_idempotent_but_changed_options_rejected(self):
        run = self.new_run()
        same = self.store.start(run['analysis_id'], 'live', 'ru', self.settings.model, True)
        self.assertEqual(same['id'], run['id'])
        with self.assertRaises(ValueError):
            self.store.start(run['analysis_id'], 'live', 'en', self.settings.model, True)
        with self.assertRaises(ValueError):
            pipeline.upload_bytes(self.store, run['analysis_id'], 'extra.md', 'after', b'1. Synthetic extra')

    def test_reviewed_partial_run_is_not_reanalyzed(self):
        run = self.finish()
        run['state'] = 'partial'
        self.store.save_run(run)
        self.store.review(run['id'], run['findings'][0]['id'], 'confirmed', 'Preserve')
        with patch.object(agent, 'run_agent') as call:
            with self.assertRaisesRegex(ValueError, 'reviewed run'):
                pipeline.execute_run(self.store, run['id'], self.settings, resume=True)
        call.assert_not_called()

    def test_free_estimate_never_instantiates_provider(self):
        run = self.new_run()
        report = estimate(self.store.documents(run['id']), self.settings)
        self.assertEqual(report['minimum_extraction_calls'], 2)
        self.assertTrue(report['extraction_count_limit_sufficient'])

    def test_resume_rejects_changed_prompt_fingerprint(self):
        run = self.finish()
        run['state'] = 'partial'
        self.store.save_run(run)
        with patch.object(pipeline, 'prompt_manifest', return_value={'sha256': 'changed', 'files': {}}), \
                patch.object(agent, 'run_agent') as call:
            with self.assertRaisesRegex(ValueError, 'Prompt version changed'):
                pipeline.execute_run(self.store, run['id'], self.settings, resume=True)
        call.assert_not_called()

    def test_api_upload_to_report_fake_agent(self):
        with patch.object(api, 'Settings', return_value=self.settings), \
                patch.object(agent, 'run_agent', side_effect=self.fake_agent), TestClient(api.app) as client:
            created = client.post('/api/analyses', json={'title': 'Synthetic API acceptance'})
            self.assertEqual(created.status_code, 201)
            analysis_id = created.json()['id']
            for side in ('before', 'after'):
                upload = client.post(f'/api/analyses/{analysis_id}/documents', data={'side': side},
                                     files=[('files', (f'{side}.md', b'1. Synthetic risk duty.', 'text/markdown'))])
                self.assertEqual(upload.status_code, 201)
            accepted = client.post(f'/api/analyses/{analysis_id}/runs',
                                   json={'mode': 'live', 'language': 'ru', 'allow_limited': True})
            self.assertEqual(accepted.status_code, 202)
            run_id = accepted.json()['run_id']
            # Let registered background work finish without a paid call or wall-clock sleep.
            async def finish_tasks():
                import asyncio
                await asyncio.gather(*list(api.app.state.tasks))
            client.portal.call(finish_tasks)
            run = client.get(f'/api/runs/{run_id}').json()
            self.assertEqual(run['state'], 'completed', run.get('errors'))
            self.assertEqual(len(client.get(f'/api/runs/{run_id}/structure').json()['changes']), 1)
            finding = client.get(f'/api/runs/{run_id}/findings').json()[0]
            evidence = client.get(f'/api/runs/{run_id}/findings/{finding["id"]}/evidence').json()
            self.assertEqual(len(evidence), 2)
            review = client.patch(f'/api/runs/{run_id}/findings/{finding["id"]}/review',
                                  json={'status': 'confirmed', 'note': 'Synthetic acceptance'})
            self.assertEqual(review.status_code, 200)
            self.assertIn('Synthetic acceptance', client.get(f'/api/runs/{run_id}/report').text)
            self.assertEqual(client.get(f'/api/runs/{run_id}/functions.csv').status_code, 200)
            self.assertEqual(client.get(f'/api/runs/{run_id}/costs').status_code, 200)


if __name__ == '__main__':
    unittest.main()
