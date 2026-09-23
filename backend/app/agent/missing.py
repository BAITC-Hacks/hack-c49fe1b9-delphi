"""Absence claims require an exhaustive pass over immutable opposite-side sources."""

from . import prompts
from .common import batches, serialized, stable_id
from .model_client import ModelClient
from .models import (
    AgentError,
    EvidenceOutput,
    FindingOutput,
    FunctionOutput,
    MissingSearch,
    SourceInput,
)
from .tools import SourceTools


async def verify_missing(
    model_client: ModelClient,
    max_batch_chars: int,
    finding: FindingOutput,
    functions: dict[str, FunctionOutput],
    sources: list[SourceInput],
    language: str,
    incomplete: bool,
    tools: SourceTools,
) -> None:
    await _verify_absence(
        model_client,
        max_batch_chars,
        finding,
        functions,
        sources,
        language,
        incomplete,
        tools,
        "after",
    )


async def verify_new(
    model_client: ModelClient,
    max_batch_chars: int,
    finding: FindingOutput,
    functions: dict[str, FunctionOutput],
    sources: list[SourceInput],
    language: str,
    incomplete: bool,
    tools: SourceTools,
) -> None:
    await _verify_absence(
        model_client,
        max_batch_chars,
        finding,
        functions,
        sources,
        language,
        incomplete,
        tools,
        "before",
    )


async def _verify_absence(
    model_client: ModelClient,
    max_batch_chars: int,
    finding: FindingOutput,
    functions: dict[str, FunctionOutput],
    sources: list[SourceInput],
    language: str,
    incomplete: bool,
    tools: SourceTools,
    side: str,
) -> None:
    opposite = [source for source in sources if source.side == side]
    target_ids = finding.before_function_ids if side == "after" else finding.after_function_ids
    targets = [functions[identifier] for identifier in target_ids]
    reviewed: set[str] = set()
    candidates: set[str] = set()
    search_errors = []
    payload_base = {
        "output_language": language,
        "before_functions" if side == "after" else "after_functions": [
            item.model_dump() for item in targets
        ],
        "target_sources": [
            source.model_dump()
            for source in sources
            if any(source.id in function.source_ids for function in targets)
        ],
    }
    allowance = max_batch_chars - len(serialized(payload_base)) - 64
    for batch in batches(opposite, max(1, allowance)):
        try:
            result = await model_client.request(
                prompts.MISSING_SEARCH if side == "after" else prompts.NEW_SEARCH,
                {**payload_base, f"{side}_sources": [source.model_dump() for source in batch]},
                MissingSearch,
            )
            expected = {source.id for source in batch}
            if (
                len(result.reviewed_source_ids) != len(expected)
                or set(result.reviewed_source_ids) != expected
                or len(result.candidate_source_ids) != len(set(result.candidate_source_ids))
                or not set(result.candidate_source_ids) <= expected
            ):
                raise AgentError("Absence search cites unknown, repeated or unreviewed sources")
            reviewed.update(expected)
            candidates.update(result.candidate_source_ids)
        except AgentError as exc:
            search_errors.append(str(exc))
    complete = (
        bool(opposite)
        and not incomplete
        and not search_errors
        and all(function.owner_unit_ids for function in targets)
        and len(reviewed) == len(opposite)
    )
    finding.search = {
        "method": f"semantic_all_{side}_batches",
        "complete": complete,
        "reviewed_source_ids": sorted(reviewed),
        "candidate_source_ids": sorted(candidates),
        "errors": search_errors,
    }
    tools.operations.append(
        {
            "tool": "semantic_missing_check" if side == "after" else "semantic_new_check",
            "finding_id": finding.id,
            "reviewed_sources": len(reviewed),
            "candidate_source_ids": sorted(candidates),
            "complete": complete,
        }
    )
    absent = complete and not candidates
    if not absent:
        finding.change_type, finding.issue_type = "changed", "insufficient_evidence"
        finding.title = {
            "ru": "Соответствие требует проверки",
            "kk": "Сәйкестікті тексеру қажет",
            "en": "Function mapping needs review",
        }[language]
        finding.explanation = {
            "ru": "Есть возможные соответствия либо поиск или источники неполны. Отсутствие соответствия не установлено.",
            "kk": "Ықтимал сәйкестіктер бар немесе іздеу не дереккөздер толық емес. Сәйкестіктің жоқтығы анықталған жоқ.",
            "en": "Possible counterparts exist or the search or inputs are incomplete. Absence has not been established.",
        }[language]
        existing = {item.source_id for item in finding.evidence}
        finding.evidence.extend(
            EvidenceOutput(source_id=key, evidence_role="context")
            for key in sorted(candidates - existing)
        )
    elif side == "after":
        finding.change_type, finding.issue_type = "potentially_missing", None
        finding.title = {
            "ru": "Соответствие не найдено в предоставленном комплекте «После»",
            "kk": "Берілген «Кейін» жиынтығында сәйкестік табылмады",
            "en": "No counterpart found in the supplied After set",
        }[language]
        finding.explanation = {
            "ru": "Все доступные исходные пункты «После» проверены. Соответствие не найдено; это не доказывает прекращение деятельности.",
            "kk": "Қолжетімді «Кейін» тармақтарының барлығы тексерілді. Сәйкестік табылмады; бұл қызметтің тоқтағанын дәлелдемейді.",
            "en": "Every available After source was checked. No counterpart was found; this does not prove the activity stopped.",
        }[language]
    else:
        finding.change_type, finding.issue_type = "new", None
        finding.title = {
            "ru": "Обязанность впервые указана в предоставленном комплекте «После»",
            "kk": "Міндет берілген «Кейін» жиынтығында алғаш көрсетілген",
            "en": "Duty first listed in the supplied After set",
        }[language]
        finding.explanation = {
            "ru": "Все доступные исходные пункты «До» проверены, соответствие не найдено. Это не доказывает дату появления работы.",
            "kk": "Қолжетімді «Бұрын» тармақтарының барлығы тексерілді, сәйкестік табылмады. Бұл жұмыстың басталу уақытын дәлелдемейді.",
            "en": "Every available Before source was checked without a counterpart. This does not establish when the work began.",
        }[language]
    finding.recommendation = {
        "ru": "Проверьте исполнителя, область ответственности и полноту комплекта документов.",
        "kk": "Орындаушыны, жауапкершілік аясын және құжаттар жиынтығының толықтығын тексеріңіз.",
        "en": "Review the owner, responsibility scope and completeness of the supplied documents.",
    }[language]
    finding.id = stable_id(
        "finding",
        finding.change_type,
        finding.issue_type,
        sorted(finding.before_function_ids),
        sorted(finding.after_function_ids),
    )
