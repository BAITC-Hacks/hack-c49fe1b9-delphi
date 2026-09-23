from .common import stable_id
from .models import (
    AgentError,
    EvidenceOutput,
    FindingDraft,
    FindingOutput,
    FunctionOutput,
    SourceInput,
)


def validate_finding(
    draft: FindingDraft, functions: dict[str, FunctionOutput], sources: dict[str, SourceInput]
) -> FindingOutput:
    for side, ids in (
        ("before", draft.before_function_ids),
        ("after", draft.after_function_ids),
    ):
        if len(set(ids)) != len(ids) or any(
            function_id not in functions or functions[function_id].side != side
            for function_id in ids
        ):
            raise AgentError("Finding cites unknown, repeated or wrong-side functions")
    evidence: list[EvidenceOutput] = []
    evidence_ids: set[str] = set()
    for item in draft.evidence:
        source = sources.get(item.source_id)
        if source is None:
            raise AgentError("Finding cites an unknown source")
        if item.evidence_role != "context" and item.evidence_role != source.side:
            raise AgentError("Evidence has the wrong comparison side")
        start, end = item.start_offset, item.end_offset
        if (start is None) != (end is None):
            raise AgentError("Evidence offsets must be supplied together")
        if start is not None and end is not None and not (0 <= start < end <= len(source.text)):
            raise AgentError("Evidence offsets are outside the source text")
        evidence.append(EvidenceOutput(**item.model_dump()))
        evidence_ids.add(source.id)
    linked = draft.before_function_ids + draft.after_function_ids
    if any(
        not set(functions[function_id].source_ids).intersection(evidence_ids)
        for function_id in linked
    ):
        raise AgentError("Finding lacks evidence for a referenced function")
    if not linked and draft.change_type != "structure_changed":
        raise AgentError("Function finding has no linked functions")
    sides = {sources[source_id].side for source_id in evidence_ids}
    if draft.change_type in {"retained", "reworded", "transferred", "split", "merged"}:
        if (
            not draft.before_function_ids
            or not draft.after_function_ids
            or sides != {"before", "after"}
        ):
            raise AgentError("Function mapping requires both sides and their sources")
    if draft.change_type == "new" and (draft.before_function_ids or not draft.after_function_ids):
        raise AgentError("New function must have only After function IDs")
    if draft.change_type == "potentially_missing" and (
        not draft.before_function_ids or draft.after_function_ids
    ):
        raise AgentError("Missing candidate must have only Before function IDs")
    if draft.change_type == "split" and len(draft.after_function_ids) < 2:
        raise AgentError("Split requires multiple After functions")
    if draft.change_type == "merged" and len(draft.before_function_ids) < 2:
        raise AgentError("Merge requires multiple Before functions")
    if draft.issue_type in {"overlap", "potential_conflict"}:
        after_sources = {
            source_id for source_id in evidence_ids if sources[source_id].side == "after"
        }
        if len(draft.after_function_ids) < 2 or len(after_sources) < 2:
            raise AgentError("Overlap/conflict needs two After functions and two After sources")
    if draft.issue_type in {"modality_changed", "scope_changed"} and not (
        draft.before_function_ids and draft.after_function_ids
    ):
        raise AgentError("Modality/scope comparison needs functions on both sides")
    identity = [
        draft.change_type,
        draft.issue_type,
        sorted(draft.before_function_ids),
        sorted(draft.after_function_ids),
    ]
    if not linked:
        identity.append(
            sorted(
                {
                    (
                        item.source_id,
                        item.evidence_role,
                        item.start_offset if item.start_offset is not None else -1,
                        item.end_offset if item.end_offset is not None else -1,
                    )
                    for item in evidence
                }
            )
        )
    return FindingOutput(
        id=stable_id("finding", *identity),
        evidence=evidence,
        **draft.model_dump(exclude={"evidence"}),
    )
