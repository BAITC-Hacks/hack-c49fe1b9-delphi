from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from app.agent.fast import FAST_INPUT_CHARS, LIMITATION, FastAnalysisEngine, FastPreview
from app.agent.models import AgentError, AnalysisOutput, SourceInput
from app.domain.result_validation import validate_output


def sources():
    return [
        SourceInput(
            id=str(uuid4()),
            document_id=str(uuid4()),
            side=side,
            clause_no="5.1",
            text=text,
            parent_text="Директор по аудиту: обязанности",
        )
        for side, text in (
            ("before", "5.1. Директор проверяет  реестр поставщиков."),
            ("after", "5.1. Директор проверяет реестр поставщиков ежегодно."),
        )
    ]


def preview():
    return FastPreview.model_validate(
        {
            "read_source_count": 2,
            "units": [
                {
                    "key": key,
                    "side": side,
                    "kind": "role",
                    "name_original": "Директор по аудиту",
                    "parent_key": None,
                    "source_ids": [source],
                }
                for key, side, source in (
                    ("ub", "before", "s0"),
                    ("ua", "after", "s1"),
                )
            ],
            "functions": [
                {
                    "key": key,
                    "side": side,
                    "owner_keys": [owner],
                    "actor_original": "Директор по аудиту",
                    "action": "Проверяет",
                    "object": "реестр поставщиков",
                    "scope": "закупки",
                    "condition": condition,
                    "modality": "обязан",
                    "source_ids": [source],
                }
                for key, side, owner, source, condition in (
                    ("fb", "before", "ub", "s0", ""),
                    ("fa", "after", "ua", "s1", "ежегодно"),
                )
            ],
            "findings": [
                {
                    "title": "Уточнена периодичность проверки",
                    "change_type": "changed",
                    "issue_type": "scope_changed",
                    "before_function_ids": ["fb"],
                    "after_function_ids": ["fa"],
                    "explanation": "Указана ежегодная проверка.",
                    "recommendation": "Проверьте план аудита.",
                    "evidence": [
                        {
                            "source_id": source,
                            "evidence_role": side,
                            "start_offset": None,
                            "end_offset": None,
                        }
                        for source, side in (("s0", "before"), ("s1", "after"))
                    ],
                }
            ],
            "structure": [
                {
                    "before_unit_ids": ["ub"],
                    "after_unit_ids": ["ua"],
                    "status": "retained",
                    "source_ids": ["s0", "s1"],
                    "explanation": "Должность сохранена.",
                }
            ],
            "reviewed_after_function_keys": [],
        }
    )


def engine(result=None):
    instance = FastAnalysisEngine(SimpleNamespace(), "test-model", 120, 4, 24000)
    instance.model_client.request = AsyncMock(return_value=result or preview())
    return instance


async def test_fast_preview_is_one_call_with_full_sources_and_valid_backend_ids():
    original = sources()
    agent = engine()
    progress, checkpoint = AsyncMock(), AsyncMock()
    result = await agent.analyze(original, "ru", progress, checkpoint=checkpoint)
    validate_output(result, original)
    assert result.partial is True
    assert result.errors == [LIMITATION["ru"]]
    assert result.coverage["processed_sources"] == len(original)
    assert result.coverage["catalog_complete"] is False
    assert result.coverage["reviewed_after_functions"] == 0
    assert result.coverage["unreviewed_function_ids"] == [result.functions[1].id]
    assert result.coverage["classified_after_functions"] == 1
    assert result.coverage["unclassified_after_function_ids"] == []
    agent.model_client.request.assert_awaited_once()
    payload = agent.model_client.request.call_args.args[1]
    assert payload["source_count"] == len(original)
    assert payload["sources"][0]["text"] == original[0].text
    assert payload["sources"][0]["parent"] == original[0].parent_text
    assert payload["sources"][1]["text"] == original[1].text
    assert agent.model_client.max_input_chars == FAST_INPUT_CHARS
    assert agent.model_client.max_tool_rounds == 0
    assert agent.model_client.max_output_tokens == 12000
    assert len(agent.model_client.request.call_args.args) == 3  # No tool registry.
    for record in result.units + result.functions + result.findings + result.structure:
        assert str(UUID(record.id)) == record.id
    assert result.findings[0].evidence[0].source_id == original[0].id
    assert result.findings[0].evidence[0].start_offset is None
    checkpoint.assert_awaited_once_with("validating", result)


async def test_fast_preview_does_not_truncate_a_large_source_set():
    original = sources()
    original.extend(
        SourceInput(
            id=str(uuid4()),
            document_id=original[index % 2].document_id,
            side=original[index % 2].side,
            text=f"SOURCE {index}: " + "Точная исходная строка. " * 8,
            parent_text=f"Родитель {index}",
        )
        for index in range(964)
    )
    parsed = preview()
    parsed.read_source_count = len(original)
    agent = engine(parsed)
    result = await agent.analyze(original, "en", AsyncMock())
    submitted = agent.model_client.request.call_args.args[1]["sources"]
    assert len(submitted) == len(original) == 966
    assert [item["text"] for item in submitted] == [source.text for source in original]
    assert [item["parent"] for item in submitted] == [source.parent_text for source in original]
    assert result.coverage["processed_sources"] == 966
    assert result.partial is True


@pytest.mark.parametrize("language", ["ru", "kk", "en"])
@pytest.mark.parametrize("change", ["new", "potentially_missing"])
async def test_fast_preview_never_publishes_unsearched_absence_claims(language, change):
    parsed = preview()
    finding = parsed.findings[0]
    finding.change_type = change
    finding.issue_type = None
    if change == "new":
        finding.before_function_ids = []
    else:
        finding.after_function_ids = []
    result = await engine(parsed).analyze(sources(), language, AsyncMock())
    finding = result.findings[0]
    assert finding.change_type == "changed"
    assert finding.issue_type == "insufficient_evidence"
    assert finding.search is None
    assert result.errors == [LIMITATION[language]]
    assert result.coverage["classified_after_functions"] == 0
    assert result.coverage["unclassified_after_function_ids"] == [result.functions[1].id]


@pytest.mark.parametrize(
    "mutation,message",
    [
        (lambda p: setattr(p.units[0], "source_ids", ["foreign"]), "unknown source"),
        (lambda p: setattr(p.functions[0], "owner_keys", ["foreign"]), "unknown unit"),
        (
            lambda p: setattr(p.findings[0], "before_function_ids", ["foreign"]),
            "unknown function",
        ),
        (
            lambda p: setattr(p.findings[0].evidence[0], "source_id", "foreign"),
            "unknown source",
        ),
        (lambda p: setattr(p.units[0], "source_ids", ["s1"]), "wrong comparison side"),
        (lambda p: setattr(p, "reviewed_after_function_keys", ["fb"]), "Before function"),
        (lambda p: setattr(p, "read_source_count", 1), "complete source set"),
    ],
)
async def test_fast_preview_rejects_invalid_references_before_saving(mutation, message):
    parsed = preview()
    mutation(parsed)
    checkpoint = AsyncMock()
    with pytest.raises(AgentError, match=message):
        await engine(parsed).analyze(sources(), "en", AsyncMock(), checkpoint=checkpoint)
    checkpoint.assert_not_awaited()


async def test_fast_preview_preserves_evidenced_after_only_risk_and_review_subset():
    original = sources()
    original.append(
        SourceInput(
            id=str(uuid4()),
            document_id=original[1].document_id,
            side="after",
            text="5.2. Аудитор также проверяет реестр поставщиков ежегодно.",
        )
    )
    parsed = preview()
    parsed.read_source_count = 3
    second = parsed.functions[1].model_copy(deep=True)
    second.key, second.source_ids, second.actor_original = "fa2", ["s2"], "Аудитор"
    parsed.functions.append(second)
    finding = parsed.findings[0]
    finding.before_function_ids = []
    finding.after_function_ids = ["fa", "fa2"]
    finding.issue_type = "overlap"
    finding.evidence = [finding.evidence[1], finding.evidence[1].model_copy(deep=True)]
    finding.evidence[1].source_id = "s2"
    parsed.reviewed_after_function_keys = ["fa"]
    result = await engine(parsed).analyze(original, "en", AsyncMock())
    assert result.findings[0].issue_type == "overlap"
    assert result.coverage["reviewed_after_functions"] == 1
    assert len(result.coverage["unclassified_after_function_ids"]) == 2


async def test_fast_preview_ids_are_stable_and_namespaced_by_original_source_registry():
    first_sources = sources()
    first = await engine().analyze(first_sources, "en", AsyncMock())
    again = await engine().analyze(first_sources, "en", AsyncMock())
    second = await engine().analyze(sources(), "en", AsyncMock())
    for field in ("units", "functions", "findings", "structure"):
        first_ids = {item.id for item in getattr(first, field)}
        assert first_ids == {item.id for item in getattr(again, field)}
        assert first_ids.isdisjoint({item.id for item in getattr(second, field)})


async def test_fast_preview_preserves_identical_duties_from_distinct_source_blocks():
    original = sources()
    original.append(original[1].model_copy(update={"id": str(uuid4())}))
    parsed = preview()
    parsed.read_source_count = 3
    duplicate = parsed.functions[1].model_copy(deep=True)
    duplicate.key = "fa_duplicate"
    duplicate.source_ids = ["s2"]
    parsed.functions.append(duplicate)
    finding = parsed.findings[0]
    finding.change_type = "changed"
    finding.issue_type = "overlap"
    finding.before_function_ids = []
    finding.after_function_ids = ["fa", "fa_duplicate"]
    finding.evidence = [finding.evidence[1], finding.evidence[1].model_copy(deep=True)]
    finding.evidence[1].source_id = "s2"
    result = await engine(parsed).analyze(original, "en", AsyncMock())
    assert len(result.functions) == 3
    assert result.functions[1].id != result.functions[2].id
    assert result.findings[0].issue_type == "overlap"
    assert len(set(result.findings[0].after_function_ids)) == 2


async def test_fast_preview_cannot_resume_an_incomplete_inventory():
    agent = engine()
    prior = AnalysisOutput(
        units=[], functions=[], findings=[], structure=[], coverage={}, errors=[],
        operations=[], partial=True,
    )
    with pytest.raises(AgentError, match="cannot resume"):
        await agent.analyze(sources(), "en", AsyncMock(), resume=prior)
    agent.model_client.request.assert_not_awaited()


async def test_fast_preview_rejects_oversize_input_without_sending_a_truncated_request():
    original = sources()
    original[0].text = "x" * FAST_INPUT_CHARS
    agent = FastAnalysisEngine(SimpleNamespace(), "test-model", 120, 4, 24000)
    with pytest.raises(AgentError, match="no input was truncated"):
        await agent.analyze(original, "en", AsyncMock())
