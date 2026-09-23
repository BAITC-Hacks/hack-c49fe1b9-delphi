from difflib import SequenceMatcher

from .common import serialized
from .models import AgentError, FunctionOutput, SourceInput, UnitOutput
from .tools import normalize


def comparison_payload(
    max_batch_chars: int,
    target: list[FunctionOutput],
    candidates: list[FunctionOutput],
    units: dict[str, UnitOutput],
    language: str,
    *,
    sources: dict[str, SourceInput] | None = None,
) -> dict:
    selected: dict[str, FunctionOutput] = {}
    for function in target:
        description = function_text(function)
        ranked = sorted(
            (other for other in candidates if other.id != function.id),
            key=lambda other: SequenceMatcher(None, description, function_text(other)).ratio(),
            reverse=True,
        )
        for candidate in ranked[:5]:
            selected[candidate.id] = candidate
    payload = {
        "output_language": language,
        "target": [function.model_dump() for function in target],
        "candidate_functions": [],
        "units": [unit.model_dump() for unit in units.values()],
        "candidate_note": "Suggestions only; search all relevant units with tools.",
    }
    if sources is not None:
        target_sources = {identifier for function in target for identifier in function.source_ids}
        payload["sources"] = [sources[key].model_dump() for key in sorted(target_sources)]
    for candidate in selected.values():
        payload["candidate_functions"].append(candidate.model_dump())
        previous_sources = payload.get("sources", [])
        if sources is not None:
            ids = {item["id"] for item in previous_sources} | set(candidate.source_ids)
            payload["sources"] = [sources[key].model_dump() for key in sorted(ids)]
        if len(serialized(payload)) > max_batch_chars:
            payload["candidate_functions"].pop()
            if sources is not None:
                payload["sources"] = previous_sources
            continue
    if len(serialized(payload)) > max_batch_chars:
        raise AgentError("Unit catalog and target exceed the configured comparison batch limit")
    return payload


def function_text(function: FunctionOutput) -> str:
    return normalize(
        " ".join(
            [
                function.action,
                function.object,
                function.scope,
                function.condition,
                function.modality,
            ]
        )
    )
