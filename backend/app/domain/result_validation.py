from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from app.agent.models import AgentError, AnalysisOutput, FindingDraft, SourceInput
from app.agent.validation import validate_finding


def uuid_value(value: str) -> UUID:
    try:
        parsed = UUID(value)
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValueError("Result contains an invalid UUID") from exc
    if str(parsed) != value:
        raise ValueError("Result UUIDs must use canonical string form")
    return parsed


class Identified(Protocol):
    id: str


def unique_ids[Item: Identified](items: Sequence[Item]) -> dict[str, Item]:
    result = {}
    for item in items:
        item_id = item.id
        uuid_value(item_id)
        if item_id in result:
            raise ValueError("Result contains duplicate IDs")
        result[item_id] = item
    return result


def references(ids: list[str], registry: dict, side: str | None = None, required=False) -> None:
    if required and not ids:
        raise ValueError("Result has an empty required reference list")
    if len(ids) != len(set(ids)):
        raise ValueError("Result contains repeated references")
    for item_id in ids:
        if item_id not in registry:
            raise ValueError("Result references an unknown record")
        if side is not None and registry[item_id].side != side:
            raise ValueError("Result references the wrong comparison side")


def validate_output(output: AnalysisOutput, sources: list[SourceInput]) -> None:
    registry = unique_ids(sources)
    units = unique_ids(output.units)
    functions = unique_ids(output.functions)
    unique_ids(output.findings)
    unique_ids(output.structure)
    for unit in units.values():
        references(unit.source_ids, registry, unit.side, required=True)
        if unit.parent_unit_id is not None:
            references([unit.parent_unit_id], units, unit.side)
        seen = set()
        current = unit
        while current.parent_unit_id is not None:
            if current.id in seen:
                raise ValueError("Unit hierarchy contains a cycle")
            seen.add(current.id)
            if current.parent_unit_id not in units:
                raise ValueError("Unit parent is absent from this result")
            current = units[current.parent_unit_id]
    for function in functions.values():
        references(function.owner_unit_ids, units, function.side, required=True)
        references(function.source_ids, registry, function.side, required=True)
    after_ids = {source.id for source in sources if source.side == "after"}
    for finding in output.findings:
        draft = FindingDraft.model_validate(finding.model_dump(exclude={"id", "search"}))
        try:
            validate_finding(draft, functions, registry)
        except AgentError as exc:
            raise ValueError(str(exc)) from exc
        if finding.search is not None:
            reviewed = finding.search.get("reviewed_source_ids")
            candidates = finding.search.get("candidate_source_ids")
            for ids in (reviewed, candidates):
                if not isinstance(ids, list) or any(not isinstance(value, str) for value in ids):
                    raise ValueError("Missing-function search has invalid source references")
                references(ids, registry, "after")
            if not set(candidates) <= set(reviewed):
                raise ValueError("Search candidates were not reviewed")
            if finding.search.get("complete") is True and set(reviewed) != after_ids:
                raise ValueError("Complete search did not cover the entire After set")
        if finding.change_type == "potentially_missing":
            if (
                finding.search is None
                or finding.search.get("complete") is not True
                or finding.search.get("method") != "semantic_all_after_batches"
                or finding.search.get("candidate_source_ids")
                or finding.search.get("errors")
            ):
                raise ValueError("Missing-function finding lacks a complete semantic search")
    seen_units = set()
    for match in output.structure:
        references(match.before_unit_ids, units, "before")
        references(match.after_unit_ids, units, "after")
        references(match.source_ids, registry, required=True)
        ids = match.before_unit_ids + match.after_unit_ids
        if not ids or seen_units.intersection(ids):
            raise ValueError("Structure contains empty or repeated unit mappings")
        seen_units.update(ids)
        if any(
            not set(units[unit_id].source_ids).intersection(match.source_ids) for unit_id in ids
        ):
            raise ValueError("Structure lacks evidence for one of its units")
        if match.status in {"retained", "transformed"} and not (
            match.before_unit_ids and match.after_unit_ids
        ):
            raise ValueError("Mapped structure requires both sides")
        if match.status == "newly_listed" and (match.before_unit_ids or not match.after_unit_ids):
            raise ValueError("Newly listed structure must reference only After units")
        if match.status == "unmatched" and (match.after_unit_ids or not match.before_unit_ids):
            raise ValueError("Unmatched structure must reference only Before units")
    if not output.partial and not output.errors and seen_units != set(units):
        raise ValueError("Completed result omits units from its structure comparison")
