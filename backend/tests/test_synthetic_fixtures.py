import json
from pathlib import Path
from typing import get_args

import pytest

from app.agent.models import ChangeType, IssueType
from app.parsers import parse_document

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())
CASES = MANIFEST["cases"]


def test_manifest_covers_each_input_once_and_labels_it_synthetic():
    assert MANIFEST["synthetic"] is True
    assert MANIFEST["schema_version"] == 1
    assert len({case["id"] for case in CASES}) == len(CASES)
    paths = [document["path"] for case in CASES for document in case["documents"]]
    assert len(paths) == len(set(paths))
    assert {str(path.relative_to(FIXTURES)) for path in FIXTURES.glob("*/*.md")} == set(paths)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_synthetic_inputs_preserve_manifest_clauses_and_parent_context(case):
    assert {document["side"] for document in case["documents"]} == {"before", "after"}
    for document in case["documents"]:
        path = (FIXTURES / document["path"]).resolve()
        assert path.is_relative_to(FIXTURES.resolve())
        content = path.read_bytes()
        assert "Синтетический документ" in content.decode("utf-8")
        parsed = parse_document(path.name, content, max_uncompressed_bytes=1_000_000)
        assert parsed.warnings == []
        assert parsed.detected_language == MANIFEST["input_language"]
        clauses = [block for block in parsed.blocks if block.clause_no]
        assert len({block.clause_no for block in clauses}) == len(clauses)
        by_number = {block.clause_no: block for block in clauses}
        for number, original in document["clauses"].items():
            block = by_number[number]
            assert block.original_text == original
            assert block.parent_key == by_number[number.rsplit(".", 1)[0]].key
            assert content.decode("utf-8").splitlines()[block.locator["line"] - 1] == original


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_expectations_reference_real_clauses_and_current_contract_labels(case):
    documents = {document["id"]: document for document in case["documents"]}
    assert len(documents) == len(case["documents"])
    assert len({item["id"] for item in case["expected_findings"]}) == len(case["expected_findings"])
    for item in case["expected_findings"] + case["forbidden_findings"]:
        assert "change_types" in item or "issue_types" in item
        assert set(item.get("change_types", [])) <= set(get_args(ChangeType))
        assert set(item.get("issue_types", [])) <= {*get_args(IssueType), None}
        references = item.get("required_sources", item.get("related_sources"))
        assert references
        for reference in references:
            document_id, clause_no = reference.split("#", 1)
            assert clause_no in documents[document_id]["clauses"]


def test_loss_expectations_require_complete_search_and_paired_issues_have_two_after_sources():
    for case in CASES:
        documents = {document["id"]: document for document in case["documents"]}
        for item in case["expected_findings"]:
            if "potentially_missing" in item.get("change_types", []):
                search = item["search"]
                assert search["complete"] is True
                assert search["all_after_source_blocks_reviewed"] is True
                assert set(search["all_after_documents"]) == {
                    key for key, document in documents.items() if document["side"] == "after"
                }
                assert search["candidate_source_ids"] == search["errors"] == []
            if {"overlap", "potential_conflict"} & set(item.get("issue_types", [])):
                after_sources = {
                    reference
                    for reference in item["required_sources"]
                    if documents[reference.split("#", 1)[0]]["side"] == "after"
                }
                assert len(after_sources) >= 2
