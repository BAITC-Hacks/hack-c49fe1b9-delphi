"""A single-request preview over the complete input, with a deliberately partial catalog."""

from typing import Literal

from openai import AsyncOpenAI
from pydantic import Field

from .common import stable_id
from .engine import AnalysisEngine, Checkpoint, Progress
from .model_client import ModelClient
from .models import (
    AgentError,
    AnalysisOutput,
    Contract,
    EvidenceDraft,
    FindingDraft,
    FunctionOutput,
    Side,
    SourceInput,
    UnitMatchOutput,
    UnitOutput,
)
from .prompts import COMMON
from .tools import normalize
from .validation import validate_finding

FAST_INPUT_CHARS = 600_000
FAST_OUTPUT_TOKENS = 12_000

LIMITATION = {
    "ru": (
        "Быстрый предварительный анализ: все исходные блоки переданы модели, но показаны "
        "только выбранные функции и ключевые изменения. Полный каталог, исчерпывающая "
        "проверка дублирования и конфликтов и отдельный поиск каждой отсутствующей или "
        "новой обязанности не выполнялись. Результат частичный и требует проверки."
    ),
    "kk": (
        "Жедел алдын ала талдау: барлық бастапқы блоктар модельге берілді, бірақ тек "
        "таңдалған функциялар мен негізгі өзгерістер көрсетілген. Толық каталог, "
        "қайталанулар мен қайшылықтарды толық тексеру, әрбір жоқ немесе жаңа міндетті "
        "жеке іздеу орындалмады. Нәтиже ішінара және тексеруді қажет етеді."
    ),
    "en": (
        "Fast preview: every original source block was supplied to the model, but only "
        "selected functions and key changes are shown. The complete inventory, exhaustive "
        "overlap/conflict review and individual missing/new-duty searches were not performed. "
        "This is a partial result requiring review."
    ),
}

UNCERTAIN = {
    "ru": (
        "Соответствие требует проверки",
        "В быстром анализе соответствие не установлено. Отдельный исчерпывающий поиск "
        "по противоположному комплекту не выполнялся; отсутствие или новизна обязанности "
        "не подтверждены.",
        "Проверьте исполнителя, область ответственности и возможные соответствия "
        "в полном комплекте документов.",
    ),
    "kk": (
        "Сәйкестікті тексеру қажет",
        "Жедел талдауда сәйкестік анықталмады. Қарама-қарсы жиынтықта жеке толық іздеу "
        "орындалмады; міндеттің жоқтығы немесе жаңалығы расталмаған.",
        "Орындаушыны, жауапкершілік аясын және толық құжаттар жиынтығындағы ықтимал "
        "сәйкестіктерді тексеріңіз.",
    ),
    "en": (
        "Function mapping needs review",
        "The fast preview did not establish a counterpart. No separate exhaustive search "
        "of the opposite document set was performed; absence or novelty is not established.",
        "Review the owner, responsibility scope and possible counterparts in the complete "
        "document set.",
    ),
}

FAST_PROMPT = COMMON + """
Produce a concise preliminary comparison in ONE pass over ALL supplied original sources,
reading both complete document sets and their parent context. This is a fast preview,
not an exhaustive function inventory. Source IDs such as s0 are exact local references;
never invent a source. Echo source_count as read_source_count after inspecting the input.

Select at most 10 useful, evidence-supported findings, prioritizing important changes
in responsibilities, units, ownership, scope and modality. If supported, include overlaps
and potential conflicts among After duties; do not invent issues. Consider relevant duties
in every chapter, not only chapter 5. Do not mistake renumbering for a change. Similar
parent/child duties, different scopes and oversight are not automatically duplicates.
Preserve actor, action, object, scope, condition and modality. Support many-to-many mappings.

Return only the units and functions needed for these selected findings and structure
matches: at most 16 units and 24 functions. Use unique short keys for units/functions,
then reference those keys in parent_key, owner_keys and all *_function_ids/*_unit_ids.
All source_ids and evidence source_id values refer to the supplied sN registry. Unit
sources and function sources must be from their own side. An uncertain owner may be [].
Every referenced function must have evidence from its sources on the matching side.
Every unit in a structure match must have one of its source_ids in that match's source_ids.
Only report retained/transformed structure matches supported on both sides.

NEVER claim a duty is new, absent, eliminated or potentially_missing: no separate exhaustive
absence searches run in this mode. If a function cannot be mapped confidently, report
change_type='changed', issue_type='insufficient_evidence' and explicitly require review.
For overlaps or potential_conflict use change_type='changed', at least two distinct After
functions with distinct original sources, and explain why their actor/scope creates a risk.
List only the After function keys you actually inspected for overlaps/conflicts in
reviewed_after_function_keys. This does not assert review of duties outside the preview.

Use concise original-language names/functions and requested-language explanations.
Do not generate quotations: cite sources and leave evidence offsets null for full original
blocks. Omit routine unchanged duties unless they substantiate a useful finding. Keep
the whole answer compact enough for the bounded output; do not repeat the source text.
"""


class FastUnit(Contract):
    key: str
    side: Side
    kind: Literal["department", "role", "group"]
    name_original: str
    parent_key: str | None
    source_ids: list[str] = Field(min_length=1)


class FastFunction(Contract):
    key: str
    side: Side
    owner_keys: list[str]
    actor_original: str
    action: str
    object: str
    scope: str
    condition: str
    modality: str
    source_ids: list[str] = Field(min_length=1)


class FastStructure(Contract):
    before_unit_ids: list[str] = Field(min_length=1)
    after_unit_ids: list[str] = Field(min_length=1)
    status: Literal["retained", "transformed"]
    source_ids: list[str] = Field(min_length=1)
    explanation: str


class FastPreview(Contract):
    read_source_count: int = Field(ge=0)
    units: list[FastUnit] = Field(max_length=16)
    functions: list[FastFunction] = Field(max_length=24)
    findings: list[FindingDraft] = Field(max_length=10)
    structure: list[FastStructure] = Field(max_length=8)
    reviewed_after_function_keys: list[str]


def _references(keys: list[str], registry: dict[str, str], kind: str) -> list[str]:
    if len(keys) != len(set(keys)):
        raise AgentError(f"Fast preview repeats {kind} references")
    if any(key not in registry for key in keys):
        raise AgentError(f"Fast preview cites an unknown {kind}")
    return [registry[key] for key in keys]


def _keys(items: list[FastUnit] | list[FastFunction], kind: str) -> None:
    keys = [item.key for item in items]
    if len(keys) != len(set(keys)) or any(not key.strip() for key in keys):
        raise AgentError(f"Fast preview contains invalid or duplicate {kind} keys")


class FastAnalysisEngine(AnalysisEngine):
    """Keep backend persistence/evidence contracts while bounding work to one model call."""

    def __init__(
        self,
        client: AsyncOpenAI,
        model: str,
        request_timeout_seconds: float,
        max_tool_rounds: int,
        max_batch_chars: int,
        *,
        max_output_tokens: int = FAST_OUTPUT_TOKENS,
    ):
        super().__init__(
            client, model, request_timeout_seconds, max_tool_rounds, max_batch_chars
        )
        # Preview has its own explicit bound and no tools; no source is truncated to fit it.
        self.model_client = ModelClient(
            client,
            model,
            request_timeout_seconds,
            0,
            FAST_INPUT_CHARS,
            max_output_tokens=max_output_tokens,
        )

    async def analyze(
        self,
        sources: list[SourceInput],
        output_language: str,
        progress: Progress,
        *,
        checkpoint: Checkpoint | None = None,
        resume: AnalysisOutput | None = None,
    ) -> AnalysisOutput:
        if resume is not None:
            raise AgentError("A fast preview cannot resume a partial function inventory")
        if output_language not in LIMITATION:
            raise AgentError("Unsupported output language")
        if {source.side for source in sources} != {"before", "after"}:
            raise AgentError("Both document sides need readable sources")
        registry = {source.id: source for source in sources}
        if len(registry) != len(sources):
            raise AgentError("Fast preview input repeats a source ID")
        aliases = {f"s{index}": source.id for index, source in enumerate(sources)}
        documents = {
            identifier: f"d{index}"
            for index, identifier in enumerate(dict.fromkeys(s.document_id for s in sources))
        }
        payload = {
            "output_language": output_language,
            "source_count": len(sources),
            "sources": [
                {
                    "id": alias,
                    "document": documents[source.document_id],
                    "side": source.side,
                    "clause": source.clause_no,
                    "text": source.text,
                    "parent": source.parent_text,
                }
                for alias, source in zip(aliases, sources, strict=True)
            ],
        }
        await progress("comparing", {"processed_sources": 0})
        preview = await self.model_client.request(FAST_PROMPT, payload, FastPreview)
        if preview.read_source_count != len(sources):
            raise AgentError("Fast preview did not acknowledge the complete source set")
        output = self._materialize(preview, sources, registry, aliases, output_language)
        await progress("validating", output.coverage)
        if checkpoint is not None:
            await checkpoint("validating", output)
        return output

    def _materialize(
        self,
        preview: FastPreview,
        sources: list[SourceInput],
        registry: dict[str, SourceInput],
        aliases: dict[str, str],
        language: str,
    ) -> AnalysisOutput:
        # The domain validator imports agent contracts; keep package imports acyclic.
        from app.domain.result_validation import validate_output

        _keys(preview.units, "unit")
        _keys(preview.functions, "function")
        namespace = stable_id("source_set", sorted(registry))
        unit_ids = {
            unit.key: stable_id(
                "unit", namespace, unit.side, unit.kind, normalize(unit.name_original)
            )
            for unit in preview.units
        }
        units = []
        for unit in preview.units:
            if not unit.name_original.strip():
                raise AgentError("Fast preview contains an unnamed unit")
            parent = (
                _references([unit.parent_key], unit_ids, "unit")[0]
                if unit.parent_key is not None
                else None
            )
            units.append(
                UnitOutput(
                    id=unit_ids[unit.key],
                    side=unit.side,
                    kind=unit.kind,
                    name_original=unit.name_original,
                    parent_unit_id=parent,
                    source_ids=_references(unit.source_ids, aliases, "source"),
                )
            )
        function_ids: dict[str, str] = {}
        functions = []
        for function in preview.functions:
            if not function.action.strip() or not function.actor_original.strip():
                raise AgentError("Fast preview function lacks an actor or action")
            owners = _references(function.owner_keys, unit_ids, "unit")
            source_ids = _references(function.source_ids, aliases, "source")
            values = function.model_dump(exclude={"key", "side", "owner_keys", "source_ids"})
            identifier = stable_id(
                "function", namespace, function.side, sorted(owners), values, sorted(source_ids)
            )
            function_ids[function.key] = identifier
            functions.append(
                FunctionOutput(
                    id=identifier,
                    side=function.side,
                    owner_unit_ids=owners,
                    source_ids=source_ids,
                    **values,
                )
            )
        function_registry = {function.id: function for function in functions}
        reviewed_after = set(
            _references(preview.reviewed_after_function_keys, function_ids, "function")
        )
        if any(function_registry[key].side != "after" for key in reviewed_after):
            raise AgentError("Fast preview risk review cites a Before function")
        findings = []
        for finding in preview.findings:
            draft = finding.model_copy(deep=True)
            draft.before_function_ids = _references(
                draft.before_function_ids, function_ids, "function"
            )
            draft.after_function_ids = _references(
                draft.after_function_ids, function_ids, "function"
            )
            draft.evidence = [
                EvidenceDraft(
                    **{
                        **item.model_dump(),
                        "source_id": _references([item.source_id], aliases, "source")[0],
                    }
                )
                for item in draft.evidence
            ]
            # After-only overlaps/conflicts are affirmative risk hypotheses, not absence claims.
            risk = draft.issue_type in {"overlap", "potential_conflict"}
            one_sided = not (draft.before_function_ids and draft.after_function_ids)
            if draft.change_type in {"new", "potentially_missing"} or (
                one_sided and not risk and draft.change_type != "structure_changed"
            ):
                draft.change_type = "changed"
                draft.issue_type = "insufficient_evidence"
                draft.title, draft.explanation, draft.recommendation = UNCERTAIN[language]
            findings.append(validate_finding(draft, function_registry, registry))
        structure = []
        for match in preview.structure:
            values = match.model_dump()
            values["before_unit_ids"] = _references(match.before_unit_ids, unit_ids, "unit")
            values["after_unit_ids"] = _references(match.after_unit_ids, unit_ids, "unit")
            values["source_ids"] = _references(match.source_ids, aliases, "source")
            structure.append(
                UnitMatchOutput(id=stable_id("structure", namespace, values), **values)
            )
        before = {function.id for function in functions if function.side == "before"}
        after = {function.id for function in functions if function.side == "after"}
        compared_before = {key for finding in findings for key in finding.before_function_ids}
        mapped_after = {
            key
            for finding in findings
            if finding.before_function_ids
            for key in finding.after_function_ids
        }
        covered_units = {
            key for match in structure for key in match.before_unit_ids + match.after_unit_ids
        }
        output = AnalysisOutput(
            units=units,
            functions=functions,
            findings=findings,
            structure=structure,
            coverage={
                "total_sources": len(sources),
                "processed_sources": len(sources),
                "before_functions": len(before),
                "compared_before_functions": len(compared_before),
                "after_functions": len(after),
                "reviewed_after_functions": len(reviewed_after),
                "classified_after_functions": len(mapped_after),
                "structure_units": len(units),
                "reviewed_structure_units": len(covered_units),
                "unprocessed_source_ids": [],
                "unreviewed_function_ids": sorted(
                    (before - compared_before) | (after - reviewed_after)
                ),
                "unclassified_after_function_ids": sorted(after - mapped_after),
                "analysis_mode": "fast",
                "catalog_complete": False,
                "exhaustive_absence_search": False,
            },
            errors=[LIMITATION[language]],
            operations=[
                {
                    "tool": "fast_preview",
                    "source_ids": [source.id for source in sources],
                    "model_requests": 1,
                    "catalog_complete": False,
                    "exhaustive_absence_search": False,
                }
            ],
            partial=True,
        )
        try:
            validate_output(output, sources)
        except ValueError as exc:
            raise AgentError(f"Fast preview failed result validation: {exc}") from exc
        return output
