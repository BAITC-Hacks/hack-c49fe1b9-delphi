from . import prompts
from .common import batches, stable_id
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
    after_sources = [source for source in sources if source.side == "after"]
    reviewed: set[str] = set()
    candidates: set[str] = set()
    search_errors = []
    for batch in batches(after_sources, max_batch_chars):
        try:
            result = await model_client.request(
                prompts.MISSING_SEARCH,
                {
                    "output_language": language,
                    "before_functions": [
                        functions[function_id].model_dump()
                        for function_id in finding.before_function_ids
                    ],
                    "after_sources": [source.model_dump() for source in batch],
                },
                MissingSearch,
            )
            expected = {source.id for source in batch}
            if (
                set(result.reviewed_source_ids) != expected
                or not set(result.candidate_source_ids) <= expected
            ):
                raise AgentError("Missing-function search cites unknown or unreviewed sources")
            reviewed.update(expected)
            candidates.update(result.candidate_source_ids)
        except AgentError as exc:
            search_errors.append(str(exc))
    complete = not incomplete and not search_errors and len(reviewed) == len(after_sources)
    finding.search = {
        "method": "semantic_all_after_batches",
        "complete": complete,
        "reviewed_source_ids": sorted(reviewed),
        "candidate_source_ids": sorted(candidates),
        "errors": search_errors,
    }
    tools.operations.append(
        {
            "tool": "semantic_missing_check",
            "finding_id": finding.id,
            "reviewed_sources": len(reviewed),
            "candidate_source_ids": sorted(candidates),
            "complete": complete,
        }
    )
    if candidates or not complete:
        finding.change_type = "changed"
        finding.issue_type = "insufficient_evidence"
        finding.title = {
            "ru": "Соответствие требует проверки",
            "kk": "Сәйкестікті тексеру қажет",
            "en": "Function mapping needs review",
        }[language]
        finding.explanation = {
            "ru": "Поиск обнаружил возможные соответствия либо выполнен не полностью. Потеря функции не установлена.",
            "kk": "Іздеу ықтимал сәйкестіктерді тапты немесе толық аяқталмады. Функцияның жоғалғаны анықталған жоқ.",
            "en": "The search found possible matches or is incomplete. A missing duty has not been established.",
        }[language]
        for source_id in sorted(candidates):
            finding.evidence.append(EvidenceOutput(source_id=source_id, evidence_role="after"))
    else:
        finding.title = {
            "ru": "Соответствие не найдено в предоставленном комплекте",
            "kk": "Берілген құжаттар жиынтығында сәйкестік табылмады",
            "en": "No counterpart found in the supplied After set",
        }[language]
        finding.explanation = {
            "ru": "Все доступные пункты комплекта «После» проверены на возможное соответствие этой обязанности. Соответствие не найдено; это не доказывает прекращения деятельности организации.",
            "kk": "Берілген «Кейін» жиынтығының барлық қолжетімді тармақтары осы міндетке сәйкестікке тексерілді. Сәйкестік табылмады; бұл ұйым қызметінің тоқтағанын дәлелдемейді.",
            "en": "Every available After source was checked for a counterpart to this duty. None was found; this does not prove that the organization stopped performing it.",
        }[language]
    finding.recommendation = {
        "ru": "Проверьте область ответственности и полноту комплекта документов перед решением.",
        "kk": "Шешім қабылдамас бұрын жауапкершілік аясын және құжаттар жиынтығының толықтығын тексеріңіз.",
        "en": "Review responsibility scope and document-set completeness before deciding.",
    }[language]
    finding.id = stable_id(
        "finding",
        finding.change_type,
        finding.issue_type,
        sorted(finding.before_function_ids),
        sorted(finding.after_function_ids),
    )
