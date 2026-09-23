"""Semantic-stage acceptance with a scripted SDK, synthetic text and no network.

The runner, request parser, source tools, stage validation and checkpoints are real.
Only OpenAI's client boundary is replaced; these are contract checks, not AI-quality
measurements. All accounting paths are isolated in a temporary directory.
"""
from __future__ import annotations

from contextlib import ExitStack
from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from delphi_lab import agent, costs
from delphi_lab.models import AgentResult, Document, Function, SourceBlock, Unit
from delphi_lab.validation import validate_result

def synthetic_documents(before=1, after=1, *, toc=False):
    documents = []
    for side, count in (("before", before), ("after", after)):
        doc_id = f"doc_{side}"
        blocks = []
        for index in range(1, count + 1):
            text = f"SYNTHETIC {side} clause {index}: owner must review report {index}."
            blocks.append(SourceBlock(
                id=f"{side}_{index}", document_id=doc_id, side=side,
                clause_no=f"1.{index}", locator=f"line:{index}",
                original_text=text, normalized_text=text.casefold(),
            ))
        if toc:
            blocks.append(SourceBlock(
                id=f"{side}_toc", document_id=doc_id, side=side, locator="line:0",
                original_text="SYNTHETIC table of contents", normalized_text="contents", kind="toc",
            ))
        documents.append(Document(
            id=doc_id, side=side, filename=f"SYNTHETIC-{side}.md", sha256=f"synthetic-{side}",
            format="md", detected_language="en", parse_status="ok", blocks=blocks,
        ))
    return documents


def mapping(before, after, *, kind="transferred", issue="none"):
    return {
        "id": "model-local-finding", "title": "Synthetic mapping",
        "change_type": kind, "issue_type": issue,
        "before_function_ids": [item["id"] for item in before],
        "after_function_ids": [item["id"] for item in after],
        "explanation": "Synthetic explanation", "recommendation": "Verify with the owners",
        "evidence": [{"source_id": source, "evidence_role": item["side"]}
                     for item in before + after for source in item["source_ids"]],
    }


class SemanticClient:
    """Respond using the received IDs, never bypassing real agent stages."""

    def __init__(self, *, extracted=None, comparison="mapped", candidates=None, overrides=None):
        self.extracted = extracted or {"before": {"before_1"}, "after": {"after_1"}}
        self.comparison = comparison
        self.candidates = candidates or {}
        self.overrides = overrides or {}
        self.requests = []
        self.closed = False
        self.responses = self

    def with_options(self, **kwargs):
        return self

    def create(self, **options):
        self.requests.append(deepcopy(options))
        schema = options["text"]["format"]["name"]
        payload = json.loads(options["input"][0]["content"])
        value = self.default(schema, payload)
        if schema in self.overrides:
            value = self.overrides[schema](deepcopy(value), payload)
        if hasattr(value, "status"):
            return value
        return SimpleNamespace(id=f"resp_synthetic_{len(self.requests)}", model="gpt-6-sol",
                               status="completed", usage=None, output=[], output_text=json.dumps(value))

    def default(self, schema, payload):
        if schema == "_Extraction":
            side = payload["side"]
            primary = payload["primary_blocks"]
            selected = [block for block in primary if block["id"] in self.extracted[side]]
            units, functions = [], []
            for block in selected:
                local_unit = f"local-unit-{block['id']}"
                units.append({
                    "id": local_unit, "side": side, "kind": "unit",
                    "name_original": f"Synthetic {side} owner {block['id']}",
                    "source_ids": [block["id"]], "parent_unit_id": None,
                })
                functions.append({
                    "id": f"local-function-{block['id']}", "side": side,
                    "owner_unit_ids": [local_unit], "actor_original": units[-1]["name_original"],
                    "action": "Review", "object": f"synthetic report {block['id']}",
                    "scope": "company", "condition": "annually", "modality": "must",
                    "source_ids": [block["id"]],
                })
            return {"units": units, "functions": functions,
                    "processed_source_ids": [block["id"] for block in primary]}
        if schema == "_Structure":
            units = payload["units"]
            before = [unit["id"] for unit in units if unit["side"] == "before"]
            after = [unit["id"] for unit in units if unit["side"] == "after"]
            return {"matches": [{
                "id": "local-structure", "before_unit_ids": before, "after_unit_ids": after,
                "status": "transformed" if before and after else "newly_listed" if after else "unmatched",
                "source_ids": sorted({source for unit in units for source in unit["source_ids"]}),
                "explanation": "Synthetic reorganization supported by the listed sources",
            }]}
        if schema == "_Comparison":
            targets = payload["target_function_ids"]
            unresolved = self.comparison == "unresolved" or not payload["after_functions"]
            return {"findings": [] if unresolved else [mapping(payload["before_functions"], payload["after_functions"])],
                    "reviewed_function_ids": targets, "unmatched_function_ids": targets if unresolved else []}
        if schema == "_Risks":
            return {"findings": [], "reviewed_function_ids": payload["target_function_ids"]}
        if schema == "_SourceSearch":
            ids = [source["id"] for source in payload["sources"]]
            return {"reviewed_source_ids": ids,
                    "candidate_source_ids": [source for source in ids if source in self.candidates.get(payload["search_side"], set())]}
        if schema == "_Translation":
            return {"findings": [{"id": finding["id"], "title": "Translated title",
                                  "explanation": "Translated explanation", "recommendation": "Translated recommendation"}
                                 for finding in payload["findings"]]}
        if schema == "_StructureTranslation":
            return {"structure": [{"id": item["id"], "explanation": "Translated structure explanation"}
                                  for item in payload["structure"]]}
        raise AssertionError(f"Unexpected model schema: {schema}")

    def payloads(self, schema):
        return [json.loads(request["input"][0]["content"]) for request in self.requests
                if request["text"]["format"]["name"] == schema]

    def close(self):
        self.closed = True


class AgentSemanticsTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.directory = directory
        self.stack.enter_context(patch.object(costs, "OUTPUT_ROOT", directory))
        self.stack.enter_context(patch.dict(os.environ, {
            "OPENAI_API_KEY": "synthetic-offline-test-key", "LAB_COST_TRACKING": "0",
            "LAB_COST_BUDGET_USD": "", "PYTHON_DOTENV_DISABLED": "1",
        }, clear=True))
        self.stack.enter_context(patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden")))
        self.factory = self.stack.enter_context(patch("openai.OpenAI"))

    def run_semantics(self, client, documents=None, **options):
        documents = documents or synthetic_documents()
        self.factory.return_value = client
        snapshots = []

        def checkpoint(progress):
            snapshot = AgentResult.model_validate(progress["result"])
            validate_result(snapshot, documents)
            snapshots.append(snapshot)

        result = agent.run_agent(documents, model="gpt-6-sol", language="en", max_input_chars=32000,
                                 max_calls=options.pop("max_calls", 100), run_id="run_synthetic_semantics",
                                 on_progress=checkpoint, **options)
        self.assertTrue(client.closed)
        validate_result(result, documents)
        return result, snapshots

    def test_full_pipeline_split_merge_structure_and_conflict_keep_all_evidence(self):
        documents = synthetic_documents(before=3, after=3)

        def compare(value, payload):
            before = sorted(payload["before_functions"], key=lambda item: item["source_ids"])
            after = sorted(payload["after_functions"], key=lambda item: item["source_ids"])
            value["findings"] = [mapping(before[:1], after[:2], kind="split"),
                                 mapping(before[1:], after[2:], kind="merged")]
            return value

        def risks(value, payload):
            value["findings"] = [mapping([], payload["after_functions"][:2], kind="review", issue="conflict")]
            return value

        client = SemanticClient(extracted={"before": {f"before_{i}" for i in range(1, 4)},
                                           "after": {f"after_{i}" for i in range(1, 4)}},
                                overrides={"_Comparison": compare, "_Risks": risks})
        result, snapshots = self.run_semantics(client, documents)
        self.assertTrue(result.complete, result.errors)
        self.assertEqual({finding.change_type for finding in result.findings}, {"split", "merged", "review"})
        self.assertEqual(len(result.structure[0].before_unit_ids), 3)
        self.assertEqual(len(result.structure[0].after_unit_ids), 3)
        self.assertEqual(len(result.structure[0].source_ids), 6)
        conflict = next(finding for finding in result.findings if finding.issue_type == "conflict")
        self.assertEqual(len({item.source_id for item in conflict.evidence}), 2)
        self.assertFalse(result.coverage["unprocessed_before_function_ids"])
        self.assertFalse(result.coverage["unprocessed_after_risk_function_ids"])
        self.assertFalse(result.coverage["unclassified_after_function_ids"])
        self.assertFalse(client.payloads("_SourceSearch"))
        self.assertTrue(any(snapshot.structure for snapshot in snapshots))

    def test_raw_source_sweeps_cover_unextracted_blocks_before_absence_claims(self):
        documents = synthetic_documents(before=2, after=3, toc=True)
        client = SemanticClient(comparison="unresolved")
        result, _ = self.run_semantics(client, documents)
        self.assertTrue(result.complete, result.errors)
        missing = next(finding for finding in result.findings if finding.change_type == "unmatched")
        added = next(finding for finding in result.findings if finding.change_type == "added")
        self.assertEqual(set(missing.search.reviewed_source_ids), {"after_1", "after_2", "after_3"})
        self.assertEqual(set(added.search.reviewed_source_ids), {"before_1", "before_2"})
        self.assertEqual(missing.search.side, "after")
        self.assertEqual(added.search.side, "before")
        self.assertTrue(missing.search.complete and added.search.complete)
        self.assertTrue(missing.search_queries)
        self.assertTrue(any(item.get("operation") == "search_clauses" for item in result.trace))

    def test_counterparts_in_unextracted_sources_prevent_false_missing_or_new(self):
        documents = synthetic_documents(before=2, after=2)
        client = SemanticClient(comparison="unresolved", candidates={"before": {"before_2"}, "after": {"after_2"}})
        result, _ = self.run_semantics(client, documents)
        self.assertTrue(result.complete, result.errors)
        self.assertEqual({finding.change_type for finding in result.findings}, {"review"})
        self.assertEqual({finding.issue_type for finding in result.findings}, {"uncertainty"})
        contexts = {item.source_id for finding in result.findings for item in finding.evidence if item.evidence_role == "context"}
        self.assertEqual(contexts, {"before_2", "after_2"})
        self.assertTrue(all(finding.search.complete for finding in result.findings))

    def test_parse_limitations_never_become_missing_or_new(self):
        documents = synthetic_documents()
        documents[1].parse_status = "limited"
        documents[1].warnings = ["SYNTHETIC unreadable table"]
        result, _ = self.run_semantics(SemanticClient(comparison="unresolved"), documents)
        self.assertFalse(result.complete)
        self.assertEqual({finding.change_type for finding in result.findings}, {"review"})
        self.assertTrue(all(not finding.search.complete for finding in result.findings))
        self.assertEqual(result.coverage["parse_gaps"][0]["document_id"], "doc_after")

    def test_invalid_extraction_does_not_commit_any_part_of_the_batch(self):
        def invalid(value, payload, defect):
            if payload["side"] == "before":
                if defect == "unknown_source":
                    value["functions"][0]["source_ids"] = ["invented_source"]
                elif defect == "empty_evidence":
                    value["functions"][0]["source_ids"] = []
                else:
                    value["processed_source_ids"] *= 2
            return value

        for defect in ("unknown_source", "empty_evidence", "duplicate_acknowledgement"):
            with self.subTest(defect=defect):
                client = SemanticClient(overrides={"_Extraction": lambda value, payload: invalid(value, payload, defect)})
                result, snapshots = self.run_semantics(client)
                self.assertFalse(result.complete)
                self.assertTrue(any("Extraction" in error for error in result.errors), result.errors)
                self.assertIn("before_1", result.coverage["unprocessed_source_ids"])
                self.assertFalse([unit for unit in result.units if unit.side == "before"])
                self.assertFalse([function for function in result.functions if function.side == "before"])
                self.assertTrue(all(not [function for function in snap.functions if function.side == "before"] for snap in snapshots))

    def test_unresolved_owner_is_preserved_without_a_completed_or_absence_claim(self):
        def ownerless(value, payload):
            if payload["side"] == "before":
                value["functions"][0]["owner_unit_ids"] = []
            return value

        client = SemanticClient(comparison="unresolved", overrides={"_Extraction": ownerless})
        result, _ = self.run_semantics(client)
        self.assertFalse(result.complete)
        function = next(item for item in result.functions if item.side == "before")
        self.assertEqual(function.owner_unit_ids, [])
        self.assertEqual(function.source_ids, ["before_1"])
        missing = next(item for item in result.findings if item.before_function_ids)
        self.assertEqual(missing.change_type, "review")
        self.assertFalse(missing.search.complete)
        self.assertTrue(any("owners are unresolved" in error for error in result.errors), result.errors)

    def test_invalid_mappings_leave_target_unprocessed_and_no_mapping_saved(self):
        def invalid(value, payload, defect):
            finding = value["findings"][0]
            if defect == "unknown_function":
                finding["after_function_ids"] = ["invented_function"]
            elif defect == "unknown_source":
                finding["evidence"][1]["source_id"] = "invented_source"
            elif defect == "missing_evidence":
                finding["evidence"] = []
            elif defect == "context_instead_of_linked_after":
                finding["evidence"][1]["evidence_role"] = "context"
            else:
                value["reviewed_function_ids"] = []
            return value

        for defect in ("unknown_function", "unknown_source", "missing_evidence", "context_instead_of_linked_after", "incomplete_coverage"):
            with self.subTest(defect=defect):
                client = SemanticClient(overrides={"_Comparison": lambda value, payload: invalid(value, payload, defect)})
                result, _ = self.run_semantics(client)
                self.assertFalse(result.complete)
                self.assertTrue(result.coverage["unprocessed_before_function_ids"])
                self.assertTrue(any("Comparison" in error for error in result.errors), result.errors)
                self.assertFalse([finding for finding in result.findings if finding.before_function_ids and finding.after_function_ids])

    def test_structure_requires_known_units_sources_and_full_coverage(self):
        def invalid(value, payload, defect):
            if defect == "unknown_unit":
                value["matches"][0]["after_unit_ids"] = ["invented_unit"]
            elif defect == "missing_evidence":
                value["matches"][0]["source_ids"] = []
            else:
                value["matches"] = []
            return value

        for defect in ("unknown_unit", "missing_evidence", "omitted_unit"):
            with self.subTest(defect=defect):
                client = SemanticClient(overrides={"_Structure": lambda value, payload: invalid(value, payload, defect)})
                result, _ = self.run_semantics(client)
                self.assertFalse(result.complete)
                self.assertEqual(result.structure, [])
                self.assertEqual(len(result.coverage["unprocessed_structure_unit_ids"]), 2)
                self.assertTrue(any("Structure" in error for error in result.errors), result.errors)

    def test_conflict_with_only_one_after_source_is_rejected(self):
        def risks(value, payload):
            value["findings"] = [mapping([], payload["after_functions"], kind="review", issue="conflict")]
            return value

        result, _ = self.run_semantics(SemanticClient(overrides={"_Risks": risks}))
        self.assertFalse(result.complete)
        self.assertTrue(result.coverage["unprocessed_after_risk_function_ids"])
        self.assertFalse([finding for finding in result.findings if finding.issue_type == "conflict"])
        self.assertTrue(any("distinct After sources" in error for error in result.errors), result.errors)

    def test_invalid_source_search_cannot_acknowledge_coverage_or_invent_absence(self):
        def search(value, payload):
            if payload["search_side"] == "after":
                value["reviewed_source_ids"] = ["invented_source"]
            return value

        result, _ = self.run_semantics(SemanticClient(comparison="unresolved", overrides={"_SourceSearch": search}))
        self.assertFalse(result.complete)
        finding = next(item for item in result.findings if item.before_function_ids)
        self.assertEqual(finding.change_type, "review")
        self.assertEqual(finding.search.reviewed_source_ids, [])
        self.assertTrue(finding.search.errors)
        self.assertTrue(result.coverage["unprocessed_before_function_ids"])

    def test_interrupted_after_sweep_resumes_only_remaining_sources(self):
        documents = synthetic_documents(after=17)
        first = SemanticClient(comparison="unresolved")
        partial, _ = self.run_semantics(first, documents, max_calls=6)
        self.assertFalse(partial.complete)
        reviewed = next(finding for finding in partial.findings if finding.before_function_ids)
        self.assertEqual(reviewed.change_type, "review")
        self.assertEqual(len(reviewed.search.reviewed_source_ids), 16)
        self.assertFalse(reviewed.search.complete)
        saved_functions = [item.model_dump() for item in partial.functions]
        saved_structure = [item.model_dump() for item in partial.structure]
        second = SemanticClient(comparison="unresolved")
        completed, _ = self.run_semantics(second, documents, resume_result=partial)
        self.assertTrue(completed.complete, completed.errors)
        self.assertFalse(second.payloads("_Extraction"))
        self.assertFalse(second.payloads("_Structure"))
        self.assertFalse(second.payloads("_Comparison"))
        after_searches = [payload for payload in second.payloads("_SourceSearch") if payload["search_side"] == "after"]
        self.assertEqual([[source["id"] for source in payload["sources"]] for payload in after_searches], [["after_17"]])
        self.assertEqual([item.model_dump() for item in completed.functions], saved_functions)
        self.assertEqual([item.model_dump() for item in completed.structure], saved_structure)
        self.assertEqual(sum(finding.change_type == "unmatched" for finding in completed.findings), 1)
        self.assertEqual(completed.usage["api_calls"], len(first.requests) + len(second.requests))

    def test_interrupted_before_sweep_preserves_addition_review_then_resumes(self):
        documents = synthetic_documents(before=17)
        first = SemanticClient(comparison="unresolved")
        partial, _ = self.run_semantics(first, documents, max_calls=8)
        self.assertFalse(partial.complete)
        addition = next(finding for finding in partial.findings if finding.after_function_ids)
        self.assertEqual(addition.change_type, "review")
        self.assertEqual(len(addition.search.reviewed_source_ids), 16)
        self.assertFalse(addition.search.complete)
        self.assertTrue(partial.coverage["unclassified_after_function_ids"])
        second = SemanticClient(comparison="unresolved")
        completed, _ = self.run_semantics(second, documents, resume_result=partial)
        self.assertTrue(completed.complete, completed.errors)
        self.assertEqual(len(second.requests), 1)
        self.assertEqual([source["id"] for source in second.payloads("_SourceSearch")[0]["sources"]], ["before_17"])
        final_addition = next(finding for finding in completed.findings if finding.change_type == "added")
        self.assertEqual(final_addition.id, addition.id)
        self.assertFalse(completed.coverage["unclassified_after_function_ids"])

    def test_translation_includes_structure_and_only_sends_editable_prose(self):
        original, _ = self.run_semantics(SemanticClient())
        saved = original.model_dump()
        client = SemanticClient()
        self.factory.return_value = client
        translated = agent.translate_result(original, "kk", "gpt-6-sol", run_id="run_synthetic_translation")
        self.assertTrue(client.closed)
        self.assertEqual(translated["structure"], [{"id": original.structure[0].id,
                                                   "explanation": "Translated structure explanation"}])
        self.assertEqual({item["id"] for item in translated["findings"]}, {item.id for item in original.findings})
        self.assertTrue(translated["draft"])
        for payload in client.payloads("_Translation"):
            self.assertTrue(all(set(item) == {"id", "title", "explanation", "recommendation"} for item in payload["findings"]))
        for payload in client.payloads("_StructureTranslation"):
            self.assertTrue(all(set(item) == {"id", "explanation"} for item in payload["structure"]))
        self.assertEqual(original.model_dump(), saved)

    def test_translation_rejects_unknown_or_missing_structure_ids_atomically(self):
        original, _ = self.run_semantics(SemanticClient())
        saved = original.model_dump()
        for defect in ("unknown", "omitted"):
            with self.subTest(defect=defect):
                def invalid(value, payload):
                    if defect == "unknown":
                        value["structure"][0]["id"] = "invented_structure"
                    else:
                        value["structure"] = []
                    return value
                client = SemanticClient(overrides={"_StructureTranslation": invalid})
                self.factory.return_value = client
                with self.assertRaisesRegex(ValueError, "[Ss]tructure.*ID|ID.*[Ss]tructure"):
                    agent.translate_result(original, "en", "gpt-6-sol", run_id="run_synthetic_translation")
                self.assertTrue(client.closed)
                self.assertEqual(original.model_dump(), saved)

    def test_resumed_extraction_rechecks_structure_comparison_and_risks_for_new_catalog(self):
        documents = synthetic_documents(before=17)

        def omit_final_batch(value, payload):
            if payload["side"] == "before" and payload["primary_blocks"][0]["id"] == "before_17":
                value["processed_source_ids"] = []
            return value

        partial, _ = self.run_semantics(SemanticClient(overrides={"_Extraction": omit_final_batch}), documents)
        self.assertFalse(partial.complete)
        self.assertEqual(partial.coverage["unprocessed_source_ids"], ["before_17"])
        self.assertTrue(partial.structure)
        self.assertFalse(partial.coverage["unprocessed_after_risk_function_ids"])
        client = SemanticClient(extracted={"before": {"before_1", "before_17"}, "after": {"after_1"}})
        completed, _ = self.run_semantics(client, documents, resume_result=partial)
        self.assertTrue(completed.complete, completed.errors)
        self.assertEqual(len(completed.functions), 3)
        self.assertEqual(len(completed.structure), 1)
        self.assertEqual(len(completed.structure[0].before_unit_ids), 2)
        self.assertEqual(len(client.payloads("_Structure")), 1)
        self.assertEqual(len(client.payloads("_Comparison")[0]["target_function_ids"]), 2)
        self.assertEqual(len(client.payloads("_Risks")), 1)
        self.assertTrue(any(item.get("operation") == "derived_results_invalidated" for item in completed.trace))

    def test_saved_pipeline_evidence_review_report_and_translation_use_real_agent(self):
        from delphi_lab import pipeline, storage
        from delphi_lab.config import Settings
        from delphi_lab.reports import localized_run, render_report
        from delphi_lab.validation import materialize_evidence

        data_root = self.directory / "store"
        data_root.mkdir()
        self.stack.enter_context(patch.object(storage, "data_dir", return_value=data_root))
        store = storage.Store()
        settings = Settings(model="gpt-6-sol", max_calls=100, max_input_chars=32000)
        analysis = store.create_analysis("SYNTHETIC SDK-boundary acceptance")
        quotes = {
            "before": "1.1. Синтетический отдел А должен проверять годовой отчёт.",
            "after": "1.1. Синтетический отдел Б должен проверять годовой отчёт.",
        }
        for side, quote in quotes.items():
            pipeline.upload_bytes(store, analysis["id"], f"SYNTHETIC-{side}.md", side, quote.encode("utf-8"))
        initial = store.start(analysis["id"], "live", "ru", settings.model, True)
        documents = store.documents(initial["id"])
        client = SemanticClient(extracted={doc.side: {block.id for block in doc.blocks} for doc in documents})
        self.factory.return_value = client
        completed = pipeline.execute_run(store, initial["id"], settings)
        self.assertEqual(completed["state"], "completed", completed["errors"])
        self.assertTrue(client.closed)
        self.assertEqual([request["text"]["format"]["name"] for request in client.requests],
                         ["_Extraction", "_Extraction", "_Structure", "_Comparison", "_Risks"])
        finding, = completed["findings"]
        self.assertTrue(finding["id"].startswith(initial["id"] + "__"))
        sources = {item["source_id"]: store.source(initial["id"], item["source_id"]) for item in finding["evidence"]}
        evidence = materialize_evidence(finding, sources)
        self.assertEqual({item["excerpt"] for item in evidence}, set(quotes.values()))
        note = "  SYNTHETIC human decision\nKeep original quotation unchanged.  "
        reviewed = store.review(initial["id"], finding["id"], "confirmed", note)
        self.assertEqual(reviewed["review_revision"], 1)
        reopened = storage.Store().run(initial["id"])
        self.assertEqual(reopened["findings"][0]["review"]["note"], note)
        original_report = render_report(store, initial["id"])
        self.assertIn(note, original_report)
        self.assertIn(completed["structure"][0]["explanation"], original_report)
        self.assertTrue(all(quote in original_report for quote in quotes.values()))

        translations = SemanticClient()
        self.factory.return_value = translations
        pipeline.translate_saved(store, initial["id"], "en", settings)
        localized = localized_run(store, initial["id"], "en")
        self.assertEqual(localized["structure"][0]["explanation"], "Translated structure explanation")
        self.assertEqual(localized["findings"][0]["evidence"], finding["evidence"])
        self.assertEqual(localized["findings"][0]["review"]["note"], note)
        translated_report = render_report(store, initial["id"], "en")
        self.assertIn("Translated structure explanation", translated_report)
        self.assertIn("Translated title", translated_report)
        self.assertTrue(all(quote in translated_report for quote in quotes.values()))
        count = len(translations.requests)
        pipeline.translate_saved(store, initial["id"], "en", settings)
        self.assertEqual(len(translations.requests), count)
        store.review(initial["id"], finding["id"], "needs_clarification", "SYNTHETIC revised decision")
        with self.assertRaises(ValueError):
            localized_run(store, initial["id"], "en")

    def test_output_limit_splits_unaccepted_extraction_and_resume_skips_accepted_child(self):
        documents = synthetic_documents(before=3)

        def output_limit(value, payload):
            if payload["side"] == "before" and len(payload["primary_blocks"]) == 3:
                return SimpleNamespace(id="resp_synthetic_output_limit", status="incomplete", usage=None,
                                       incomplete_details={"reason": "max_output_tokens"}, output=[], output_text="")
            return value

        extracted = {"before": {"before_1", "before_2", "before_3"}, "after": {"after_1"}}
        first = SemanticClient(extracted=extracted, overrides={"_Extraction": output_limit})
        partial, _ = self.run_semantics(first, documents, max_calls=2)
        self.assertFalse(partial.complete)
        self.assertEqual([function.source_ids for function in partial.functions], [["before_1"]])
        self.assertEqual(set(partial.coverage["unprocessed_source_ids"]), {"before_2", "before_3", "after_1"})
        self.assertTrue(any(item.get("operation") == "split_unaccepted_extraction" for item in partial.trace))
        self.assertEqual([[block["id"] for block in payload["primary_blocks"]] for payload in first.payloads("_Extraction")],
                         [["before_1", "before_2", "before_3"], ["before_1"]])
        second = SemanticClient(extracted=extracted)
        completed, _ = self.run_semantics(second, documents, resume_result=partial)
        self.assertTrue(completed.complete, completed.errors)
        self.assertEqual([[block["id"] for block in payload["primary_blocks"]] for payload in second.payloads("_Extraction")],
                         [["before_2", "before_3"], ["after_1"]])
        self.assertEqual(len(completed.functions), 4)
        self.assertEqual(completed.usage["api_calls"], len(first.requests) + len(second.requests))

    def test_tools_paginate_sources_functions_and_references_without_losing_ids(self):
        documents = synthetic_documents(after=65)
        for block in documents[1].blocks:
            block.original_text += " Follow clause 1.65."
            block.normalized_text = block.original_text.casefold()
        runner = agent._Runner(documents, "gpt-6-sol", "en", 40, 5000, 32000, 4, 900, None)
        runner.result.units = [Unit(id="synthetic_owner", side="after", kind="unit", name_original="Synthetic owner",
                                    source_ids=["after_1"])]
        runner.result.functions = [Function(
            id=f"synthetic_fn_{index}", side="after", owner_unit_ids=["synthetic_owner"],
            actor_original="Synthetic owner", action="Review", object=f"report {index}",
            scope="company", condition="", modality="must", source_ids=[f"after_{index}"],
        ) for index in range(1, 24)]

        def collect(name, arguments, key):
            collected, pages, offset = [], [], 0
            while True:
                page = runner.execute_tool(name, {**arguments, "offset": offset})
                pages.append(page)
                collected.extend(page[key])
                if not page["has_more"]:
                    self.assertIsNone(page["next_offset"])
                    return collected, pages
                self.assertGreater(page["next_offset"], offset)
                offset = page["next_offset"]

        sources, source_pages = collect("search_clauses", {"side": "after", "query": "synthetic report",
                                      "filters": {"document_id": None, "clause_prefix": None}}, "matches")
        self.assertEqual({source["id"] for source in sources}, {f"after_{index}" for index in range(1, 66)})
        self.assertEqual(len(sources), 65)
        self.assertEqual(len(source_pages), 7)
        self.assertTrue(all(page["all_side_scanned"] for page in source_pages))
        functions, function_pages = collect("get_unit_functions", {"side": "after", "unit_id": "synthetic_owner"}, "functions")
        self.assertEqual(len(function_pages), 2)
        self.assertEqual({function["id"] for function in functions}, {f"synthetic_fn_{index}" for index in range(1, 24)})
        references, reference_pages = collect("check_references", {"document_id": "doc_after"}, "references")
        self.assertEqual(len(reference_pages), 2)
        self.assertEqual(len(references), 65)
        self.assertEqual({reference["source_id"] for reference in references}, {f"after_{index}" for index in range(1, 66)})
        self.assertTrue(all(reference["target_ids"] == ["after_65"] for reference in references))
        exact = runner.execute_tool("get_clause", {"source_id": "after_65"})
        self.assertEqual(exact["text"], documents[1].blocks[-1].original_text)
        for bad in (-1, True, "1"):
            with self.subTest(offset=bad), self.assertRaises(ValueError):
                runner.execute_tool("check_references", {"document_id": "doc_after", "offset": bad})
        with self.assertRaises(ValueError):
            runner.execute_tool("get_clause", {"source_id": "invented_source"})
        self.factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
