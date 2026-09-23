"""Synthetic SDK responses exercise real stages, prompts and validators offline."""
from contextlib import ExitStack
from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from delphi_lab import agent, costs
from delphi_lab.models import AgentResult, Document, Evidence, Finding, Function, SourceBlock, Unit
from delphi_lab.storage import validate_translation
from delphi_lab.validation import validate_result
from test_cost_tracking import DumpObject, ScriptedClient, response


def documents(before=2, after=2):
    return [Document(id=side, side=side, filename=f'{side}.md', sha256='synthetic',
                     format='md', detected_language='en', parse_status='ok', blocks=[
        SourceBlock(id=f'{side}_{i}', document_id=side, side=side, locator=f'line {i}',
                    clause_no=f'5.{i}', original_text=f'Synthetic {side} team reviews report {i}.',
                    normalized_text=f'synthetic {side} team reviews report {i}')
        for i in range(1, count + 1)]) for side, count in [('before', before), ('after', after)]]


def extraction(payload):
    side = payload['side']
    ids = [block['id'] for block in payload['primary_blocks']]
    return {'units': [Unit(id='department', side=side, kind='unit', name_original=f'{side} team',
                          source_ids=ids).model_dump(),
                      Unit(id='director', side=side, kind='role', name_original='Director',
                           parent_unit_id='department', source_ids=ids).model_dump()],
            'functions': [Function(id=f'local_{i}', side=side, owner_unit_ids=['director'],
                actor_original='Director', action='review', object=f'report {i}', scope='company',
                condition='', modality='must', source_ids=[key]).model_dump() for i, key in enumerate(ids)],
            'processed_source_ids': ids}


def mapping(before, after, change='transferred', issue='none'):
    return Finding(id='model_finding', title='Synthetic mapping', change_type=change, issue_type=issue,
                   before_function_ids=[f['id'] for f in before], after_function_ids=[f['id'] for f in after],
                   explanation='Synthetic evidence-backed explanation', recommendation='Verify the owner',
                   evidence=[Evidence(source_id=key, evidence_role=f['side'])
                             for f in before + after for key in f['source_ids']]).model_dump()


class CallbackClient(ScriptedClient):
    def __init__(self, callback):
        super().__init__()
        self.callback = callback

    def create(self, **options):
        self.requests.append(deepcopy(options))
        schema = options['text']['format']['name']
        payload = json.loads(options['input'][0]['content'])
        result = self.callback(schema, payload, len(self.requests))
        return result if hasattr(result, 'status') else response(text=json.dumps(result))


class AgentSemanticsTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(costs, 'OUTPUT_ROOT', root))
        self.stack.enter_context(patch.dict(os.environ, {'OPENAI_API_KEY': 'synthetic-only',
            'OPENAI_BASE_URL': 'https://api.openai.com/v1', 'LAB_COST_TRACKING': '0', 'LAB_COST_BUDGET_USD': ''}))
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('No network')))
        self.factory = self.stack.enter_context(patch('openai.OpenAI'))
        self.stack.enter_context(patch.object(agent.time, 'sleep'))

    def runner(self, docs=None, callback=None, *, resume=None, max_calls=100):
        runner = agent._Runner(docs or documents(), 'gpt-6-sol', 'en', max_calls, 5000,
                              16000, 4, 900, None, run_id='synthetic_semantics', resume_result=resume)
        runner.client = CallbackClient(callback) if callback else ScriptedClient()
        return runner

    def catalog(self, docs=None):
        runner = self.runner(docs)
        for doc in runner.documents:
            unit = Unit(id=f'u_{doc.side}', side=doc.side, kind='unit', name_original=doc.side + ' team',
                        source_ids=[doc.blocks[0].id])
            runner.result.units.append(unit)
            runner.result.functions.extend(Function(id=f'fn_{block.id}', side=doc.side,
                owner_unit_ids=[unit.id], actor_original=unit.name_original, action='review', object='report',
                scope='company', condition='', modality='must', source_ids=[block.id]) for block in doc.blocks)
        runner.processed = set(runner.blocks)
        return runner

    @staticmethod
    def normal_reply(schema, payload, call):
        if schema == '_Extraction':
            return extraction(payload)
        if schema == '_Structure':
            before = [u for u in payload['units'] if u['side'] == 'before']
            after = [u for u in payload['units'] if u['side'] == 'after']
            return {'matches': [{'id': 'local_structure', 'before_unit_ids': [u['id'] for u in before],
                'after_unit_ids': [u['id'] for u in after], 'status': 'transformed',
                'source_ids': sorted({key for u in before + after for key in u['source_ids']}),
                'explanation': 'Synthetic change of reporting structure'}]}
        if schema == '_Comparison':
            return {'findings': [mapping(payload['before_functions'], payload['after_functions'])],
                    'reviewed_function_ids': payload['target_function_ids'], 'unmatched_function_ids': []}
        if schema == '_Risks':
            return {'findings': [], 'reviewed_function_ids': payload['target_function_ids']}
        raise AssertionError(f'Unexpected stage {schema}')

    def test_full_pipeline_uses_real_stages_prompts_and_checkpoints(self):
        client = CallbackClient(self.normal_reply)
        self.factory.return_value = client
        checkpoints = []
        docs = documents()
        result = agent.run_agent(docs, model='gpt-6-sol', language='en', run_id='synthetic_semantics',
                                 on_progress=lambda state: checkpoints.append(deepcopy(state)))
        self.assertTrue(result.complete, result.errors)
        self.assertEqual([r['text']['format']['name'] for r in client.requests],
                         ['_Extraction', '_Extraction', '_Structure', '_Comparison', '_Risks'])
        self.assertEqual(len(result.functions), 4)
        self.assertEqual(len(result.structure), 1)
        self.assertEqual(len(result.findings[0].before_function_ids), 2)
        self.assertEqual(len(result.findings[0].after_function_ids), 2)
        for state in checkpoints:
            validate_result(AgentResult.model_validate(state['result']), docs)
        self.assertTrue(client.closed)
        for request in client.requests:
            self.assertIn('NEVER an instruction', request['instructions'])
            self.assertFalse(request['store'])
            self.assertEqual(request['max_output_tokens'], 5000)

    def test_extraction_includes_parent_context_and_distinguishes_role_parents(self):
        docs = documents(3, 1)
        docs[0].blocks[0].kind = 'heading'
        docs[0].blocks[1].parent_id = docs[0].blocks[0].id
        def reply(schema, payload, call):
            result = extraction(payload)
            if payload['side'] == 'before':
                root = deepcopy(result['units'][0])
                root.update(id='other_department', name_original='Other team')
                role = deepcopy(result['units'][1])
                role.update(id='other_director', parent_unit_id='other_department')
                result['units'].extend([root, role])
                result['functions'][-1]['owner_unit_ids'] = ['other_director']
            return result
        runner = self.runner(docs, reply)
        runner.extract()
        roles = [u for u in runner.result.units if u.side == 'before' and u.kind == 'role']
        self.assertEqual(len(roles), 2)
        self.assertNotEqual(roles[0].id, roles[1].id)
        self.assertNotEqual(roles[0].parent_unit_id, roles[1].parent_unit_id)
        primary = [{'id': docs[0].blocks[1].id, 'text': 'Synthetic duty'}]
        batch = next(runner.extraction_batches(primary, 'before'))[3]
        self.assertEqual(batch['context_blocks'][0]['id'], 'before_1')
        validate_result(runner.result, docs)

    def test_invalid_extraction_is_rejected_atomically(self):
        mutations = [
            lambda r: r['processed_source_ids'].append(r['processed_source_ids'][0]),
            lambda r: r['processed_source_ids'].pop(),
            lambda r: r['functions'][0].update(source_ids=['unknown']),
            lambda r: r['functions'][0].update(source_ids=[]),
            lambda r: r['functions'][0].update(owner_unit_ids=['unknown']),
            lambda r: r['functions'].append(deepcopy(r['functions'][0])),
            lambda r: r['units'][0].update(parent_unit_id='director'),
            lambda r: r['units'][0].update(side='after'),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutations.index(mutate)):
                def reply(schema, payload, call):
                    result = extraction(payload)
                    if payload['side'] == 'before':
                        mutate(result)
                    return result
                runner = self.runner(callback=reply)
                runner.extract()
                self.assertTrue(runner.result.errors)
                self.assertEqual(runner.processed, {'after_1', 'after_2'})
                self.assertTrue(all(f.side == 'after' for f in runner.result.functions))
                validate_result(runner.result, runner.documents)

    def test_output_limit_splits_only_unaccepted_extraction(self):
        def reply(schema, payload, call):
            if call == 1:
                result = response(status='incomplete')
                result.incomplete_details = {'reason': 'max_output_tokens'}
                return result
            return extraction(payload)
        runner = self.runner(documents(2, 1), reply)
        runner.extract()
        self.assertFalse(runner.result.errors)
        self.assertEqual(runner.processed, set(runner.blocks))
        self.assertEqual(runner.calls, 4)
        self.assertEqual(len(runner.result.functions), 3)
        self.assertTrue(any(t['operation'] == 'split_unaccepted_extraction' for t in runner.result.trace))

    def test_other_incomplete_reasons_do_not_split_or_hide_gap(self):
        def reply(schema, payload, call):
            result = response(status='incomplete')
            result.incomplete_details = {'reason': 'content_filter'}
            return result
        runner = self.runner(callback=reply)
        runner.extract()
        self.assertEqual(runner.calls, 2)
        self.assertEqual(runner.processed, set())
        self.assertEqual(len(runner.result.errors), 2)

    def test_single_source_output_limit_remains_unprocessed(self):
        result = response(status='incomplete')
        result.incomplete_details = {'reason': 'max_output_tokens'}
        runner = self.runner(documents(1, 1), lambda *args: result)
        runner.extract()
        self.assertEqual(runner.calls, 2)
        self.assertFalse(runner.processed)
        self.assertIn('cannot be split safely', runner.result.errors[0])

    def test_structure_rejects_unknown_ids_missing_evidence_and_partial_catalog(self):
        mutations = [lambda r: r['matches'][0]['after_unit_ids'].append('unknown'),
                     lambda r: r['matches'][0].update(source_ids=[]),
                     lambda r: r['matches'][0].update(source_ids=['before_1']),
                     lambda r: r.update(matches=[]),
                     lambda r: r['matches'].append(deepcopy(r['matches'][0]))]
        for mutate in mutations:
            with self.subTest(mutation=mutations.index(mutate)):
                runner = self.catalog()
                def reply(schema, payload, call):
                    result = self.normal_reply(schema, payload, call)
                    mutate(result)
                    return result
                runner.client = CallbackClient(reply)
                runner.structure()
                self.assertFalse(runner.result.structure)
                self.assertEqual(runner.result.coverage['structure_units_reviewed'], 0)
                self.assertTrue(runner.result.errors)

    def test_exact_structure_match_does_not_call_provider(self):
        runner = self.catalog()
        for unit in runner.result.units:
            unit.name_original = 'Same department'
        runner.structure()
        self.assertEqual(runner.result.structure[0].status, 'retained')
        self.assertEqual(runner.client.requests, [])

    def test_changed_parent_requires_structure_review(self):
        runner = self.catalog()
        for unit in list(runner.result.units):
            parent = unit.model_copy(update={'id': 'parent_' + unit.side, 'name_original': unit.side + ' board'})
            runner.result.units.append(parent)
            unit.name_original = 'Same department'
            unit.parent_unit_id = parent.id
        runner.client = CallbackClient(self.normal_reply)
        runner.structure()
        self.assertEqual(len(runner.client.requests), 1)
        self.assertEqual(runner.result.structure[0].status, 'transformed')

    def test_many_to_many_and_split_merge_mappings(self):
        for before_count, after_count, change in [(2, 2, 'transferred'), (1, 2, 'split'), (2, 1, 'merged')]:
            with self.subTest(change=change):
                runner = self.catalog(documents(before_count, after_count))
                def reply(schema, payload, call):
                    return {'findings': [mapping(payload['before_functions'], payload['after_functions'], change)],
                            'reviewed_function_ids': payload['target_function_ids'], 'unmatched_function_ids': []}
                runner.client = CallbackClient(reply)
                runner.compare()
                self.assertFalse(runner.result.errors)
                self.assertEqual(runner.result.findings[0].change_type, change)
                self.assertEqual(len(runner.compared), before_count)
                validate_result(runner.result, runner.documents)

    def test_same_parent_name_under_changed_ancestor_is_not_auto_retained(self):
        runner = self.catalog()
        for unit in list(runner.result.units):
            grandparent = unit.model_copy(update={'id': 'grand_' + unit.side,
                                                  'name_original': unit.side + ' region'})
            parent = unit.model_copy(update={'id': 'parent_' + unit.side, 'name_original': 'Common parent',
                                            'parent_unit_id': grandparent.id})
            runner.result.units.extend([parent, grandparent])
            unit.name_original = 'Common child'
            unit.parent_unit_id = parent.id
        runner.client = CallbackClient(self.normal_reply)
        runner.structure()
        self.assertEqual(len(runner.result.structure), 1)
        self.assertEqual(runner.result.structure[0].status, 'transformed')
        self.assertEqual(len(runner.result.structure[0].before_unit_ids), 3)

    def test_comparison_rejects_invalid_ids_evidence_and_coverage(self):
        mutations = [lambda r: r['findings'][0]['after_function_ids'].append('unknown'),
                     lambda r: r['findings'][0].update(evidence=[]),
                     lambda r: r['findings'][0]['evidence'][0].update(evidence_role='context'),
                     lambda r: r['reviewed_function_ids'].append(r['reviewed_function_ids'][0]),
                     lambda r: r.update(unmatched_function_ids=r['reviewed_function_ids']),
                     lambda r: r['findings'][0]['evidence'][0].update(source_id='unknown')]
        for mutate in mutations:
            with self.subTest(mutation=mutations.index(mutate)):
                runner = self.catalog()
                def reply(schema, payload, call):
                    result = self.normal_reply(schema, payload, call)
                    mutate(result)
                    return result
                runner.client = CallbackClient(reply)
                runner.compare()
                self.assertFalse(runner.result.findings)
                self.assertFalse(runner.compared)
                self.assertTrue(runner.result.errors)

    @staticmethod
    def no_match(schema, payload, call):
        if schema == '_Comparison':
            return {'findings': [], 'reviewed_function_ids': payload['target_function_ids'],
                    'unmatched_function_ids': payload['target_function_ids']}
        if schema == '_SourceSearch':
            return {'reviewed_source_ids': [b['id'] for b in payload['sources']], 'candidate_source_ids': []}
        raise AssertionError(schema)

    def test_missing_search_covers_original_sources_not_only_extracted_functions(self):
        runner = self.catalog(documents(1, 17))
        runner.result.functions = runner.result.functions[:2]  # Most After sources have no extracted function.
        runner.client = CallbackClient(self.no_match)
        runner.compare()
        finding = runner.result.findings[0]
        self.assertEqual(finding.change_type, 'unmatched')
        self.assertTrue(finding.search.complete)
        self.assertEqual(set(finding.search.reviewed_source_ids), {f'after_{i}' for i in range(1, 18)})
        validate_result(runner.result, runner.documents)

    def test_search_candidates_and_parse_gaps_cannot_become_absence_claims(self):
        for mode in ('candidate', 'parse_gap'):
            with self.subTest(mode=mode):
                runner = self.catalog(documents(1, 2))
                if mode == 'parse_gap':
                    runner.documents[1].parse_status = 'limited'
                def reply(schema, payload, call):
                    result = self.no_match(schema, payload, call)
                    if schema == '_SourceSearch' and mode == 'candidate':
                        result['candidate_source_ids'] = [payload['sources'][-1]['id']]
                    return result
                runner.client = CallbackClient(reply)
                runner.compare()
                self.assertEqual(runner.result.findings[0].change_type, 'review')
                validate_result(runner.result, runner.documents)

    def test_partial_source_batch_and_unknown_candidates_are_not_accepted(self):
        for mode in ('partial', 'unknown', 'duplicate'):
            with self.subTest(mode=mode):
                runner = self.catalog(documents(1, 2))
                def reply(schema, payload, call):
                    result = self.no_match(schema, payload, call)
                    if schema == '_SourceSearch':
                        if mode == 'partial':
                            result['reviewed_source_ids'].pop()
                        else:
                            result['candidate_source_ids'] = ['unknown'] if mode == 'unknown' else ['after_1', 'after_1']
                    return result
                runner.client = CallbackClient(reply)
                runner.compare()
                search = runner.result.findings[0].search
                self.assertFalse(search.complete)
                self.assertEqual(search.reviewed_source_ids, [])
                self.assertFalse(runner.compared)

    def test_source_search_resume_reuses_accepted_batches_and_updates_finding(self):
        runner = self.catalog(documents(1, 17))
        runner.max_calls = 2  # comparison + first source batch
        runner.client = CallbackClient(self.no_match)
        with self.assertRaises(agent._Stopped):
            runner.compare()
        self.assertFalse(runner.result.findings[0].search.complete)
        self.assertEqual(len(runner.result.findings[0].search.reviewed_source_ids), 16)
        resumed = self.runner(runner.documents, self.no_match, resume=runner.result)
        resumed.compare()
        self.assertEqual(len(resumed.client.requests), 1)
        payload = json.loads(resumed.client.requests[0]['input'][0]['content'])
        self.assertEqual([b['id'] for b in payload['sources']], ['after_17'])
        self.assertEqual(len(resumed.result.findings), 1)
        self.assertEqual(resumed.result.findings[0].change_type, 'unmatched')
        self.assertTrue(resumed.result.findings[0].search.complete)
        self.assertEqual(resumed.calls, 3)

    def test_resume_after_extraction_gap_invalidates_downstream_only(self):
        runner = self.catalog()
        runner.client = CallbackClient(self.normal_reply)
        runner.structure()
        runner.compare()
        runner.processed.remove('after_2')
        runner.checkpoint('partial')
        resumed = self.runner(runner.documents, resume=runner.result)
        self.assertEqual(resumed.result.functions, runner.result.functions)
        self.assertFalse(resumed.result.findings)
        self.assertFalse(resumed.result.structure)
        self.assertFalse(resumed.compared)
        self.assertEqual(resumed.processed, set(runner.blocks) - {'after_2'})

    def test_new_function_requires_reverse_raw_source_search(self):
        for candidate in (False, True):
            with self.subTest(candidate=candidate):
                runner = self.catalog(documents(3, 1))
                def reply(schema, payload, call):
                    self.assertEqual(payload['search_side'], 'before')
                    result = self.no_match(schema, payload, call)
                    if candidate:
                        result['candidate_source_ids'] = ['before_3']
                    return result
                runner.client = CallbackClient(reply)
                runner.additions()
                finding = runner.result.findings[0]
                self.assertEqual(finding.change_type, 'review' if candidate else 'added')
                self.assertEqual(len(finding.search.reviewed_source_ids), 3)
                validate_result(runner.result, runner.documents)

    def test_risk_stage_accepts_overlap_and_conflict_with_distinct_sources(self):
        for issue in ('overlap', 'conflict'):
            with self.subTest(issue=issue):
                runner = self.catalog()
                def reply(schema, payload, call):
                    return {'findings': [mapping([], payload['after_functions'], 'review', issue)],
                            'reviewed_function_ids': payload['target_function_ids']}
                runner.client = CallbackClient(reply)
                runner.risks()
                self.assertEqual(runner.result.findings[0].issue_type, issue)
                self.assertEqual(len(runner.risk_reviewed), 2)
                validate_result(runner.result, runner.documents)

    def test_risk_rejects_single_source_and_unrelated_evidence(self):
        runner = self.catalog()
        def reply(schema, payload, call):
            finding = mapping([], payload['after_functions'], 'review', 'conflict')
            finding['evidence'] = finding['evidence'][:1]
            return {'findings': [finding], 'reviewed_function_ids': payload['target_function_ids']}
        runner.client = CallbackClient(reply)
        runner.risks()
        self.assertFalse(runner.result.findings)
        self.assertFalse(runner.risk_reviewed)
        self.assertTrue(runner.result.errors)

    def test_search_functions_and_reference_tools_paginate_without_loss(self):
        runner = self.catalog(documents(1, 65))
        for block in runner.documents[1].blocks:
            block.original_text += ' See clause 5.1.'
        cases = [('search_clauses', {'side': 'after', 'query': 'reviews report', 'filters': {}}, 'matches', 65),
                 ('get_unit_functions', {'side': 'after', 'unit_id': 'u_after'}, 'functions', 65),
                 ('check_references', {'document_id': 'after'}, 'references', 65)]
        for name, args, key, count in cases:
            collected, offset = [], 0
            while True:
                page = runner.execute_tool(name, {**args, 'offset': offset})
                collected.extend(page[key])
                if not page['has_more']:
                    break
                self.assertGreater(page['next_offset'], offset)
                offset = page['next_offset']
            self.assertEqual(len(collected), count)
            self.assertEqual(len({json.dumps(row, sort_keys=True) for row in collected}), count)

    def test_tools_reject_bad_arguments_and_never_truncate_source(self):
        runner = self.catalog()
        for name, args in [('get_clause', {'source_id': 'unknown'}),
                           ('get_unit_functions', {'unit_id': 'u_after', 'side': 'before'}),
                           ('search_clauses', {'side': 'after', 'query': 'review', 'filters': {}, 'offset': -1}),
                           ('search_clauses', {'side': 'after', 'query': 'review', 'filters': {'clause_prefix': 3}})]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                runner.execute_tool(name, args)
        runner.max_input_chars = 10
        with self.assertRaisesRegex(ValueError, 'not truncated'):
            runner.execute_tool('get_clause', {'source_id': 'before_1'})

    def test_tool_rounds_use_last_round_none_and_retain_context(self):
        runner = self.catalog()
        runner.max_tool_rounds = 1
        call = DumpObject(type='function_call', name='get_clause', call_id='synthetic_call',
                          arguments=json.dumps({'source_id': 'after_1'}))
        runner.client = ScriptedClient(response(output=[call]), response())
        runner.request('risks', {'synthetic': True}, agent._Risks, tools=True)
        self.assertEqual([r['tool_choice'] for r in runner.client.requests], ['auto', 'none'])
        messages = runner.client.requests[1]['input']
        self.assertEqual(messages[0]['role'], 'user')
        self.assertEqual(messages[-1]['type'], 'function_call_output')
        self.assertIn('Synthetic after team', messages[-1]['output'])

    def test_translation_translates_findings_and_structure_without_sources(self):
        runner = self.catalog()
        runner.client = CallbackClient(self.normal_reply)
        runner.structure()
        runner.compare()
        original = runner.result.model_dump()
        for locale in ('ru', 'kk', 'en'):
            def reply(schema, payload, call):
                self.assertNotIn('source_ids', json.dumps(payload))
                self.assertNotIn('Synthetic before team reviews', json.dumps(payload))
                key = 'findings' if schema == '_Translation' else 'structure'
                return {key: [{name: value if name == 'id' else f'{locale}: {value}' for name, value in item.items()}
                              for item in payload[key]]}
            client = CallbackClient(reply)
            self.factory.return_value = client
            translated = agent.translate_result(runner.result, locale, 'gpt-6-sol', run_id='synthetic_translation')
            validate_translation(original, locale, translated)
            self.assertEqual(len(client.requests), 2)
            self.assertEqual(runner.result.model_dump(), original)
            self.assertEqual(translated['draft'], locale == 'kk')

    def test_tool_context_limit_stops_without_dropping_earlier_messages(self):
        runner = self.catalog()
        runner.max_input_chars = 100
        call = DumpObject(type='function_call', name='get_clause', call_id='synthetic_call',
                          arguments=json.dumps({'source_id': 'unknown_' + 'x' * 1000}))
        runner.client = ScriptedClient(response(output=[call]))
        with self.assertRaisesRegex(agent._Stopped, 'context budget'):
            runner.request('risks', {}, agent._Risks, tools=True)
        self.assertEqual(len(runner.client.requests), 1)
        self.assertEqual(runner.client.requests[0]['input'][0]['content'], '{}')

    def test_incomplete_source_response_leaves_explicit_search_gap(self):
        runner = self.catalog(documents(1, 2))
        def reply(schema, payload, call):
            if schema == '_SourceSearch':
                result = response(status='incomplete')
                result.incomplete_details = {'reason': 'max_output_tokens'}
                return result
            return self.no_match(schema, payload, call)
        runner.client = CallbackClient(reply)
        runner.compare()
        finding = runner.result.findings[0]
        self.assertEqual(finding.change_type, 'review')
        self.assertFalse(finding.search.complete)
        self.assertTrue(finding.search.errors)
        self.assertEqual(finding.search.reviewed_source_ids, [])

    def test_incomplete_translation_returns_no_partial_translation(self):
        runner = self.catalog()
        runner.client = CallbackClient(self.normal_reply)
        runner.structure()
        self.factory.return_value = ScriptedClient(response(status='incomplete'))
        with self.assertRaisesRegex(ValueError, 'not accepted'):
            agent.translate_result(runner.result, 'kk', 'gpt-6-sol', run_id='synthetic_translation')

    def test_structure_only_translation_rejects_unknown_ids(self):
        runner = self.catalog()
        runner.client = CallbackClient(self.normal_reply)
        runner.structure()
        self.factory.return_value = ScriptedClient(response(text=json.dumps({'structure': [
            {'id': 'foreign', 'explanation': 'Synthetic'}]})))
        with self.assertRaisesRegex(ValueError, 'structure ID'):
            agent.translate_result(runner.result, 'en', 'gpt-6-sol', run_id='synthetic_translation')


if __name__ == '__main__':
    unittest.main()
