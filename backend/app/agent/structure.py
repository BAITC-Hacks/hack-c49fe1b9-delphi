from . import prompts
from .common import serialized, stable_id
from .model_client import ModelClient
from .models import AgentError, StructureComparison, UnitMatchOutput, UnitOutput
from .tools import SourceTools


async def compare_structure(
    model_client: ModelClient,
    max_batch_chars: int,
    units: dict[str, UnitOutput],
    tools: SourceTools,
    language: str,
) -> list[UnitMatchOutput]:
    payload = {
        "output_language": language,
        "units": [unit.model_dump() for unit in units.values()],
    }
    if len(serialized(payload)) > max_batch_chars:
        raise AgentError("Unit catalog exceeds the configured structure comparison limit")
    result = await model_client.request(
        prompts.COMMON
        + """
Compare every Before and After unit/role/group. Distinguish jobs from departments.
Return many-to-many unit matches: retained, newly_listed, transformed, or unmatched.
Newly listed does not prove when a department was created. Unmatched does not prove
abolition. Cite sources of every referenced unit. Include each unit exactly once.
Use tools to inspect unclear names and parent context.
""",
        payload,
        StructureComparison,
        tools,
    )
    matches = []
    seen: set[str] = set()
    for match in result.matches:
        referenced = match.before_unit_ids + match.after_unit_ids
        if (
            not referenced
            or len(set(referenced)) != len(referenced)
            or seen.intersection(referenced)
        ):
            raise AgentError("Structure contains empty or repeated unit mappings")
        for side, ids in (("before", match.before_unit_ids), ("after", match.after_unit_ids)):
            if any(unit_id not in units or units[unit_id].side != side for unit_id in ids):
                raise AgentError("Structure cites unknown or wrong-side units")
        if any(source_id not in tools.sources for source_id in match.source_ids):
            raise AgentError("Structure cites unknown sources")
        if any(
            not set(units[unit_id].source_ids).intersection(match.source_ids)
            for unit_id in referenced
        ):
            raise AgentError("Structure lacks evidence for a referenced unit")
        if match.status in {"retained", "transformed"} and not (
            match.before_unit_ids and match.after_unit_ids
        ):
            raise AgentError("Mapped structure needs both sides")
        if match.status == "newly_listed" and (match.before_unit_ids or not match.after_unit_ids):
            raise AgentError("Newly listed unit must be on the After side")
        if match.status == "unmatched" and (not match.before_unit_ids or match.after_unit_ids):
            raise AgentError("Unmatched unit must be on the Before side")
        seen.update(referenced)
        matches.append(
            UnitMatchOutput(id=stable_id("structure", match.model_dump()), **match.model_dump())
        )
    if seen != set(units):
        raise AgentError("Structure comparison omitted units")
    return matches
