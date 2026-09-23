from difflib import SequenceMatcher

from .common import serialized
from .models import AgentError, FunctionOutput, UnitOutput
from .tools import normalize


def comparison_payload(
    max_batch_chars: int,
    target: list[FunctionOutput],
    candidates: list[FunctionOutput],
    units: dict[str, UnitOutput],
    language: str,
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
    for candidate in selected.values():
        payload["candidate_functions"].append(candidate.model_dump())
        if len(serialized(payload)) > max_batch_chars:
            payload["candidate_functions"].pop()
            break
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
