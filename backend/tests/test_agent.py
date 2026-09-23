import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.agent import AgentError, AnalysisEngine, SourceInput
from app.agent.extraction import merge_extraction
from app.agent.missing import verify_missing
from app.agent.models import (
    Comparison,
    EvidenceDraft,
    Extraction,
    FindingDraft,
    FindingOutput,
    FunctionOutput,
    MissingSearch,
    StructureComparison,
    UnitMatchDraft,
)
from app.agent.tools import SourceTools
from app.agent.validation import validate_finding


def source(source_id="old", side="before", text="Audit the supplier register."):
    return SourceInput(
        id=source_id,
        document_id=f"document-{side}",
        side=side,
        clause_no="5.1",
        text=text,
        parent_text="Audit director duties",
    )


def function(function_id="f-old", side="before", source_id="old", owner="u-old"):
    return FunctionOutput(
        id=function_id,
        side=side,
        owner_unit_ids=[owner],
        actor_original="Audit director",
        action="Audit",
        object="supplier register",
        scope="procurement",
        condition="annually",
        modality="required",
        source_ids=[source_id],
    )


def evidence(source_id, side):
    return EvidenceDraft(
        source_id=source_id, evidence_role=side, start_offset=None, end_offset=None
    )


def draft(before=None, after=None, change="transferred", issue=None):
    return FindingDraft(
        title="Transferred duty",
        change_type=change,
        issue_type=issue,
        before_function_ids=["f-old"] if before is None else before,
        after_function_ids=["f-new"] if after is None else after,
        explanation="The owner changed.",
        recommendation="Check the scope.",
        evidence=[evidence("old", "before"), evidence("new", "after")],
    )


def response(parsed=None, output=None, status="completed"):
    return SimpleNamespace(
        status=status, output=[] if output is None else output, output_parsed=parsed
    )


def engine(mock=None, rounds=2):
    parse = mock or AsyncMock()

    async def raw_parse(**kwargs):
        value = await parse(**kwargs)
        details = getattr(value, "incomplete_details", None)
        envelope = {
            "status": value.status,
            "incomplete_details": (
                details if isinstance(details, dict) else {"reason": getattr(details, "reason", None)}
            ),
        }
        return SimpleNamespace(
            http_response=SimpleNamespace(json=lambda: envelope), parse=lambda: value
        )

    client = SimpleNamespace(
        responses=SimpleNamespace(with_raw_response=SimpleNamespace(parse=raw_parse))
    )
    return AnalysisEngine(client, "test-model", 5, rounds, 16000)


def test_tools_reject_foreign_sources_and_wrong_side_units():
    tools = SourceTools([source()], [function()])
    with pytest.raises(AgentError, match="Unknown source"):
        tools.call("get_clause", '{"source_id":"foreign"}')
    with pytest.raises(AgentError, match="other comparison side"):
        tools.call("get_unit_functions", '{"unit_id":"u-old","side":"after","offset":0}')
    with pytest.raises(AgentError, match="Unknown tool"):
        tools.call("delete_document", "{}")


def test_tool_search_trace_and_original_text():
    original = "Audit   the supplier register."
    tools = SourceTools([source(text=original)], [])
    result = json.loads(tools.call("get_clause", '{"source_id":"old"}'))
    assert result["text"] == original
    result = json.loads(
        tools.call("search_clauses", '{"side":"before","query":"supplier","offset":0}')
    )
    assert result["matches"][0]["id"] == "old"
    assert result["method"] == "lexical"
    assert tools.operations == [
        {"tool": "get_clause", "source_ids": ["old"]},
        {"tool": "search_clauses", "side": "before", "query": "supplier", "source_ids": ["old"]},
    ]


def test_reference_validator_accepts_many_to_many_and_checks_every_function():
    registry = {
        item.id: item
        for item in [source(), source("old-2"), source("new", "after"), source("new-2", "after")]
    }
    functions = {
        item.id: item
        for item in [
            function(),
            function("f-old-2", source_id="old-2"),
            function("f-new", "after", "new"),
            function("f-new-2", "after", "new-2"),
        ]
    }
    finding = draft(before=["f-old", "f-old-2"], after=["f-new", "f-new-2"], change="changed")
    finding.evidence += [evidence("old-2", "before"), evidence("new-2", "after")]
    validated = validate_finding(finding, functions, registry)
    assert len(validated.before_function_ids) == 2
    assert len(validated.after_function_ids) == 2
    finding.evidence.pop()
    with pytest.raises(AgentError, match="lacks evidence"):
        validate_finding(finding, functions, registry)


@pytest.mark.parametrize(
    "mutation,error",
    [
        (lambda value: setattr(value.evidence[0], "source_id", "foreign"), "unknown source"),
        (
            lambda value: setattr(value.evidence[0], "evidence_role", "after"),
            "wrong comparison side",
        ),
        (lambda value: setattr(value, "before_function_ids", ["f-new"]), "wrong-side functions"),
        (lambda value: setattr(value.evidence[0], "start_offset", 0), "supplied together"),
    ],
)
def test_reference_validator_rejects_invalid_evidence(mutation, error):
    finding = draft()
    mutation(finding)
    functions = {"f-old": function(), "f-new": function("f-new", "after", "new")}
    registry = {"old": source(), "new": source("new", "after")}
    with pytest.raises(AgentError, match=error):
        validate_finding(finding, functions, registry)


def test_conflict_requires_two_distinct_after_sources():
    finding = draft(
        before=[], after=["f-new", "f-new-2"], change="changed", issue="potential_conflict"
    )
    functions = {
        "f-new": function("f-new", "after", "new"),
        "f-new-2": function("f-new-2", "after", "new"),
    }
    with pytest.raises(AgentError, match="two After sources"):
        validate_finding(finding, functions, {"old": source(), "new": source("new", "after")})


def test_structure_finding_ids_use_sources_and_preserve_evidence_order_independence():
    finding = draft(before=[], after=[], change="structure_changed")
    registry = {"old": source(), "new": source("new", "after")}
    first = validate_finding(finding, {}, registry)
    finding.evidence.reverse()
    assert validate_finding(finding, {}, registry).id == first.id
    finding.evidence = [evidence("another-old", "before"), evidence("another-new", "after")]
    registry = {
        "another-old": source("another-old"),
        "another-new": source("another-new", "after"),
    }
    assert validate_finding(finding, {}, registry).id != first.id


async def test_tool_loop_preserves_calls_and_returns_structured_result():
    call = SimpleNamespace(
        type="function_call", name="get_clause", arguments='{"source_id":"old"}', call_id="call-1"
    )
    call.model_dump = lambda **_: {
        "type": "function_call",
        "name": call.name,
        "arguments": call.arguments,
        "call_id": call.call_id,
    }
    parsed = Comparison(reviewed_function_ids=[], findings=[])
    mock = AsyncMock(side_effect=[response(output=[call]), response(parsed)])
    tools = SourceTools([source()], [])
    result = await engine(mock).model_client.request("Compare", {}, Comparison, tools)
    assert result == parsed
    second_input = mock.call_args_list[1].kwargs["input"]
    assert second_input[-1]["type"] == "function_call_output"
    assert json.loads(second_input[-1]["output"])["id"] == "old"
    assert mock.call_args.kwargs["store"] is False


async def test_bounded_tool_loop_fails_explicitly():
    call = SimpleNamespace(
        type="function_call", name="get_clause", arguments='{"source_id":"old"}', call_id="call-1"
    )
    mock = AsyncMock(return_value=response(output=[call]))
    with pytest.raises(AgentError, match="round limit"):
        await engine(mock, rounds=0).model_client.request(
            "Compare", {}, Comparison, SourceTools([source()], [])
        )
    assert mock.await_count == 1


@pytest.mark.parametrize(
    "status,parsed,message",
    [
        ("incomplete", None, "incomplete"),
        ("completed", None, "refused"),
    ],
)
async def test_incomplete_or_refused_response_is_not_a_success(status, parsed, message):
    with pytest.raises(AgentError, match=message):
        await engine(AsyncMock(return_value=response(parsed, status=status))).model_client.request(
            "Compare", {}, Comparison
        )


async def test_empty_extraction_cannot_claim_completed_comparison():
    async def parse(**kwargs):
        payload = json.loads(kwargs["input"][0]["content"])
        ids = [item["id"] for item in payload["sources"]]
        return response(Extraction(processed_source_ids=ids, units=[], functions=[]))

    progress = AsyncMock()
    result = await engine(AsyncMock(side_effect=parse)).analyze(
        [source(), source("new", "after")], "en", progress
    )
    assert result.partial is True
    assert result.findings == []
    assert result.coverage["processed_sources"] == 2
    assert any("No functions extracted" in error for error in result.errors)


async def test_full_mocked_pipeline_tracks_structure_and_multi_function_mapping():
    async def parse(**kwargs):
        payload = json.loads(kwargs["input"][0]["content"])
        if kwargs["text_format"] is Extraction:
            current = payload["sources"][0]
            return response(
                Extraction.model_validate(
                    {
                        "processed_source_ids": [current["id"]],
                        "units": [
                            {
                                "key": "audit",
                                "kind": "department",
                                "name_original": current["side"] + " Audit",
                                "parent_key": None,
                                "source_ids": [current["id"]],
                            }
                        ],
                        "functions": [
                            {
                                "owner_keys": ["audit"],
                                "actor_original": "Audit",
                                "action": "audit",
                                "object": "register " + str(index),
                                "scope": "procurement",
                                "condition": "",
                                "modality": "required",
                                "source_ids": [current["id"]],
                            }
                            for index in (1, 2)
                        ],
                    }
                )
            )
        if kwargs["text_format"] is StructureComparison:
            units = payload["units"]
            return response(
                StructureComparison(
                    matches=[
                        UnitMatchDraft(
                            before_unit_ids=[
                                item["id"] for item in units if item["side"] == "before"
                            ],
                            after_unit_ids=[
                                item["id"] for item in units if item["side"] == "after"
                            ],
                            status="transformed",
                            source_ids=["old", "new"],
                            explanation="Responsibilities moved.",
                        )
                    ]
                )
            )
        target = payload["target"]
        if target[0]["side"] == "before":
            finding = draft(
                before=[item["id"] for item in target],
                after=[item["id"] for item in payload["candidate_functions"]],
                change="changed",
            )
            return response(
                Comparison(
                    reviewed_function_ids=[item["id"] for item in target], findings=[finding]
                )
            )
        return response(
            Comparison(reviewed_function_ids=[item["id"] for item in target], findings=[])
        )

    mock = AsyncMock(side_effect=parse)
    result = await engine(mock).analyze([source(), source("new", "after")], "en", AsyncMock())
    assert result.partial is False
    assert len(result.functions) == 4
    assert len(result.findings[0].before_function_ids) == 2
    assert len(result.findings[0].after_function_ids) == 2
    assert result.structure[0].status == "transformed"
    assert result.coverage["unreviewed_function_ids"] == []
    assert mock.await_count == 5


@pytest.mark.parametrize(
    "candidate,processed,missing", [([], ["new"], True), (["new"], ["new"], False), ([], [], False)]
)
async def test_missing_finding_requires_complete_semantic_after_search(
    candidate, processed, missing
):
    result = MissingSearch(
        reviewed_source_ids=processed, candidate_source_ids=candidate, explanation="Checked source."
    )
    mock = AsyncMock(return_value=response(result))
    finding = FindingOutput(
        id="finding", **draft(after=[], change="potentially_missing").model_dump()
    )
    sources = [source(), source("new", "after")]
    tools = SourceTools(sources, [function()])
    await verify_missing(
        engine(mock).model_client,
        16000,
        finding,
        {"f-old": function()},
        sources,
        "en",
        False,
        tools,
    )
    assert (finding.change_type == "potentially_missing") is missing
    if not missing:
        assert finding.issue_type == "insufficient_evidence"
    assert finding.search["method"] == "semantic_all_after_batches"


def test_unit_ids_are_namespaced_by_analysis_sources():
    data = Extraction.model_validate(
        {
            "processed_source_ids": ["old"],
            "units": [
                {
                    "key": "audit",
                    "kind": "department",
                    "name_original": "Audit",
                    "parent_key": None,
                    "source_ids": ["old"],
                }
            ],
            "functions": [],
        }
    )
    first, second = {}, {}
    merge_extraction(data, [source()], first, {}, "first-analysis")
    merge_extraction(data, [source()], second, {}, "second-analysis")
    assert set(first).isdisjoint(second)
