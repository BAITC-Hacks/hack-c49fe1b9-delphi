"""Native semantic/checkpoint checks; every SDK call is scripted."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from test_agent import draft, engine, evidence, function, response, source

from app.agent import AgentError
from app.agent.extraction import merge_extraction
from app.agent.missing import verify_new
from app.agent.models import (
    Comparison,
    Extraction,
    FindingOutput,
    MissingSearch,
    StructureComparison,
    UnitMatchDraft,
)
from app.agent.tools import SourceTools
from app.agent.validation import validate_finding


def extraction(items, *, ownerless=False):
    return Extraction.model_validate(
        {
            "processed_source_ids": [item["id"] for item in items],
            "units": [
                {
                    "key": "unit",
                    "kind": "department",
                    "name_original": items[0]["side"] + " audit",
                    "parent_key": None,
                    "source_ids": [item["id"] for item in items],
                }
            ],
            "functions": [
                {
                    "owner_keys": [] if ownerless else ["unit"],
                    "actor_original": "Audit",
                    "action": "Review",
                    "object": item["text"],
                    "scope": "company",
                    "condition": "",
                    "modality": "must",
                    "source_ids": [item["id"]],
                }
                for item in items
            ],
        }
    )


def scripted_pipeline(*, unresolved=False, ownerless=False, source_candidate=False):
    async def parse(**kwargs):
        payload = json.loads(kwargs["input"][0]["content"])
        schema = kwargs["text_format"]
        if schema is Extraction:
            return response(extraction(payload["sources"], ownerless=ownerless))
        if schema is StructureComparison:
            return response(
                StructureComparison(
                    matches=[
                        UnitMatchDraft(
                            before_unit_ids=[
                                item["id"] for item in payload["units"] if item["side"] == "before"
                            ],
                            after_unit_ids=[
                                item["id"] for item in payload["units"] if item["side"] == "after"
                            ],
                            status="transformed",
                            source_ids=["old", "new"],
                            explanation="Changed unit",
                        )
                    ]
                )
            )
        if schema is MissingSearch:
            items = payload.get("before_sources", payload.get("after_sources"))
            return response(
                MissingSearch(
                    reviewed_source_ids=[item["id"] for item in items],
                    candidate_source_ids=[items[0]["id"]] if source_candidate else [],
                    explanation="All supplied sources checked",
                )
            )
        targets = payload["target"]
        findings = []
        if targets[0]["side"] == "before":
            item = draft(
                before=[row["id"] for row in targets],
                after=[] if unresolved else [row["id"] for row in payload["candidate_functions"]],
                change="potentially_missing" if unresolved else "transferred",
            )
            if unresolved:
                item.evidence = [evidence("old", "before")]
            findings.append(item)
        return response(
            Comparison(reviewed_function_ids=[item["id"] for item in targets], findings=findings)
        )

    return parse


@pytest.mark.parametrize(
    "candidates,reviewed,owners,is_new",
    [
        ([], ["old"], ["u-new"], True),
        (["old"], ["old"], ["u-new"], False),
        ([], [], ["u-new"], False),
        ([], ["old"], [], False),
    ],
)
async def test_new_duty_requires_complete_original_before_search(
    candidates, reviewed, owners, is_new
):
    target = function("f-new", "after", "new")
    target.owner_unit_ids = owners
    finding = FindingOutput(id="candidate", **draft(before=[], change="new").model_dump())
    finding.evidence = [evidence("new", "after")]
    sources = [source(), source("new", "after")]
    mocked = AsyncMock(
        return_value=response(
            MissingSearch(
                reviewed_source_ids=reviewed, candidate_source_ids=candidates, explanation="checked"
            )
        )
    )
    await verify_new(
        engine(mocked).model_client,
        16000,
        finding,
        {target.id: target},
        sources,
        "en",
        False,
        SourceTools(sources, [target]),
    )
    assert (finding.change_type == "new") is is_new
    assert finding.search["method"] == "semantic_all_before_batches"
    assert "target_sources" in json.loads(mocked.call_args.kwargs["input"][0]["content"])


async def test_pipeline_checks_every_unmapped_after_even_without_model_new_proposal():
    mocked = AsyncMock(side_effect=scripted_pipeline(unresolved=True))
    saved = AsyncMock()
    result = await engine(mocked).analyze(
        [source(), source("new", "after")], "en", AsyncMock(), checkpoint=saved
    )
    assert result.partial is False
    assert {item.change_type for item in result.findings} == {"potentially_missing", "new"}
    assert result.coverage["classified_after_functions"] == 1
    assert result.coverage["unclassified_after_function_ids"] == []
    searches = [
        item.kwargs for item in mocked.call_args_list if item.kwargs["text_format"] is MissingSearch
    ]
    assert len(searches) == 2
    assert saved.await_count >= 5
    first = saved.call_args_list[0].args[1]
    assert first.partial is True
    assert first.coverage["unprocessed_source_ids"] == ["new"]
    assert all(item.search for item in saved.call_args.args[1].findings)


async def test_raw_candidate_and_owner_uncertainty_cannot_become_absence():
    for options in ({"source_candidate": True}, {"ownerless": True}):
        result = await engine(
            AsyncMock(side_effect=scripted_pipeline(unresolved=True, **options))
        ).analyze([source(), source("new", "after")], "en", AsyncMock())
        assert all(item.change_type == "changed" for item in result.findings)
        assert all(item.issue_type == "insufficient_evidence" for item in result.findings)
        if options.get("ownerless"):
            assert result.partial
            assert any("owners are unresolved" in error for error in result.errors)


async def test_resume_skips_saved_extraction_after_interruption():
    snapshots = []

    async def stop(stage, snapshot):
        snapshots.append(snapshot)
        raise TimeoutError("synthetic interruption")

    first_mock = AsyncMock(side_effect=scripted_pipeline())
    with pytest.raises(TimeoutError):
        await engine(first_mock).analyze(
            [source(), source("new", "after")], "en", AsyncMock(), checkpoint=stop
        )
    assert first_mock.await_count == 1
    second_mock = AsyncMock(side_effect=scripted_pipeline())
    result = await engine(second_mock).analyze(
        [source(), source("new", "after")], "en", AsyncMock(), resume=snapshots[-1]
    )
    assert result.partial is False
    extraction_calls = [
        call for call in second_mock.call_args_list if call.kwargs["text_format"] is Extraction
    ]
    assert len(extraction_calls) == 1
    assert (
        json.loads(extraction_calls[0].kwargs["input"][0]["content"])["sources"][0]["id"] == "new"
    )


async def test_complete_snapshot_resume_does_not_repeat_paid_work():
    result = await engine(AsyncMock(side_effect=scripted_pipeline())).analyze(
        [source(), source("new", "after")], "en", AsyncMock()
    )
    mocked = AsyncMock(side_effect=AssertionError("No additional calls"))
    resumed = await engine(mocked).analyze(
        [source(), source("new", "after")], "en", AsyncMock(), resume=result
    )
    assert not resumed.partial
    mocked.assert_not_awaited()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value.processed_source_ids.append("old"),
        lambda value: value.units[0].source_ids.append("old"),
        lambda value: value.functions[0].owner_keys.append("unit"),
    ],
)
def test_extraction_repeated_ids_never_commit_half_a_batch(mutation):
    value = extraction([source().model_dump()])
    mutation(value)
    units, functions = {}, {}
    with pytest.raises(AgentError):
        merge_extraction(value, [source()], units, functions, "namespace")
    assert units == functions == {}


def test_context_only_and_duplicate_evidence_cannot_support_a_function():
    functions = {"f-old": function(), "f-new": function("f-new", "after", "new")}
    sources = {"old": source(), "new": source("new", "after")}
    value = draft()
    value.evidence[1].evidence_role = "context"
    with pytest.raises(AgentError, match="lacks evidence"):
        validate_finding(value, functions, sources)
    value = draft()
    value.evidence.append(value.evidence[0])
    with pytest.raises(AgentError, match="repeats"):
        validate_finding(value, functions, sources)


async def test_structured_sdk_validation_failure_is_a_recoverable_agent_error():
    try:
        Comparison.model_validate({"unexpected": "synthetic"})
    except ValidationError as error:
        mocked = AsyncMock(side_effect=error)
    with pytest.raises(AgentError, match="invalid structured"):
        await engine(mocked).model_client.request("test", {}, Comparison)
    assert mocked.await_count == 1


async def test_final_tool_round_explicitly_disables_tools():
    value = response(Comparison(reviewed_function_ids=[], findings=[]))
    mocked = AsyncMock(return_value=value)
    await engine(mocked, rounds=0).model_client.request(
        "test", {}, Comparison, SourceTools([source()], [])
    )
    assert mocked.call_args.kwargs["tool_choice"] == "none"
    assert mocked.call_args.kwargs["max_output_tokens"] == 5000


def test_reference_tool_paginates_without_losing_known_targets():
    sources = [source(str(index), text="See clause 5.1") for index in range(25)]
    tool = SourceTools(sources, [])
    first = json.loads(
        tool.call("check_references", json.dumps({"document_id": "document-before", "offset": 0}))
    )
    second = json.loads(
        tool.call(
            "check_references",
            json.dumps({"document_id": "document-before", "offset": first["next_offset"]}),
        )
    )
    assert len(first["references"]) == 20
    assert len(second["references"]) == 5
    assert second["has_more"] is False
    assert len(first["references"][0]["target_ids"]) == 25


async def test_extraction_output_limit_splits_only_unaccepted_batch():
    base = scripted_pipeline()
    attempts = 0

    async def parse(**kwargs):
        nonlocal attempts
        if kwargs["text_format"] is Extraction:
            attempts += 1
            if attempts == 1:
                value = response(status="incomplete")
                value.incomplete_details = SimpleNamespace(reason="max_output_tokens")
                return value
        return await base(**kwargs)

    inputs = [source(), source("old-two", text="Different duty"), source("new", "after")]
    result = await engine(AsyncMock(side_effect=parse)).analyze(inputs, "en", AsyncMock())
    assert result.coverage["processed_sources"] == 3
    assert any(item["tool"] == "split_unaccepted_extraction" for item in result.operations)
    assert not any("Extraction" in error for error in result.errors)


def test_ownerless_function_ids_are_isolated_by_source_namespace():
    item = source()
    extracted = extraction([item.model_dump()], ownerless=True)
    first, second = {}, {}
    merge_extraction(extracted, [item], {}, first, "source-set-one")
    merge_extraction(extracted, [item], {}, second, "source-set-two")
    assert set(first).isdisjoint(second)
