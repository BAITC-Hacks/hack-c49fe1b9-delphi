from .common import stable_id
from .models import AgentError, Extraction, FunctionOutput, SourceInput, UnitOutput
from .tools import normalize


def merge_extraction(
    result: Extraction,
    batch: list[SourceInput],
    units: dict[str, UnitOutput],
    functions: dict[str, FunctionOutput],
    namespace: str,
) -> None:
    source_ids = {source.id for source in batch}
    if (
        len(result.processed_source_ids) != len(source_ids)
        or set(result.processed_source_ids) != source_ids
    ):
        raise AgentError("Extraction did not process exactly the supplied source batch")
    side = batch[0].side
    local_keys = {unit.key for unit in result.units}
    if len(local_keys) != len(result.units) or any(not key.strip() for key in local_keys):
        raise AgentError("Duplicate local unit keys")
    for unit in result.units:
        if (
            len(unit.source_ids) != len(set(unit.source_ids))
            or not set(unit.source_ids) <= source_ids
            or not unit.name_original.strip()
        ):
            raise AgentError("Unit cites unknown sources or has no name")
        if unit.parent_key is not None and (
            unit.parent_key not in local_keys or unit.parent_key == unit.key
        ):
            raise AgentError("Invalid parent unit key")
    for function in result.functions:
        if (
            len(function.source_ids) != len(set(function.source_ids))
            or len(function.owner_keys) != len(set(function.owner_keys))
            or not set(function.source_ids) <= source_ids
            or not set(function.owner_keys) <= local_keys
        ):
            raise AgentError("Function cites unknown sources or owners")
        if not function.action.strip() or not function.actor_original.strip():
            raise AgentError("Extracted function has no actor or action")
    key_ids = {
        unit.key: stable_id("unit", namespace, side, unit.kind, normalize(unit.name_original))
        for unit in result.units
    }
    staged_units = {unit_id: unit.model_copy(deep=True) for unit_id, unit in units.items()}
    for unit in result.units:
        unit_id = key_ids[unit.key]
        parent_id = key_ids[unit.parent_key] if unit.parent_key else None
        if unit_id in staged_units:
            existing = staged_units[unit_id]
            if (
                existing.parent_unit_id is not None
                and parent_id is not None
                and existing.parent_unit_id != parent_id
            ):
                raise AgentError("Inconsistent extracted parent unit")
            existing.source_ids = sorted(set(existing.source_ids + unit.source_ids))
            if parent_id is not None:
                existing.parent_unit_id = parent_id
        else:
            staged_units[unit_id] = UnitOutput(
                id=unit_id,
                side=side,
                kind=unit.kind,
                name_original=unit.name_original,
                parent_unit_id=parent_id,
                source_ids=unit.source_ids,
            )
    for unit_id in staged_units:
        seen = set()
        current = unit_id
        while current is not None:
            if current in seen:
                raise AgentError("Extracted unit hierarchy contains a cycle")
            seen.add(current)
            current = staged_units[current].parent_unit_id
    units.update(staged_units)
    for function in result.functions:
        owner_ids = sorted({key_ids[key] for key in function.owner_keys})
        values = function.model_dump(exclude={"owner_keys", "source_ids"})
        function_id = stable_id("function", namespace, side, owner_ids, values)
        if function_id in functions:
            functions[function_id].source_ids = sorted(
                set(functions[function_id].source_ids + function.source_ids)
            )
        else:
            functions[function_id] = FunctionOutput(
                id=function_id,
                side=side,
                owner_unit_ids=owner_ids,
                source_ids=function.source_ids,
                **values,
            )
