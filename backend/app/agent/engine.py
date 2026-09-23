from collections.abc import Awaitable, Callable

from openai import AsyncOpenAI

from . import prompts
from .common import batches, stable_id
from .extraction import merge_extraction
from .matching import comparison_payload
from .missing import verify_missing, verify_new
from .model_client import ModelClient
from .models import (
    AgentError,
    AnalysisOutput,
    Comparison,
    EvidenceOutput,
    Extraction,
    FindingOutput,
    FunctionOutput,
    OutputLimit,
    SourceInput,
    UnitMatchOutput,
    UnitOutput,
)
from .structure import compare_structure
from .tools import SourceTools
from .validation import validate_finding

Progress = Callable[[str, dict], Awaitable[None]]
Checkpoint = Callable[[str, AnalysisOutput], Awaitable[None]]


class AnalysisEngine:
    def __init__(
        self,
        client: AsyncOpenAI,
        model: str,
        request_timeout_seconds: float,
        max_tool_rounds: int,
        max_batch_chars: int,
    ):
        if (
            not model.strip()
            or request_timeout_seconds <= 0
            or max_tool_rounds < 0
            or max_batch_chars < 2000
        ):
            raise ValueError("Invalid agent configuration")
        self.model_client = ModelClient(
            client, model, request_timeout_seconds, max_tool_rounds, max_batch_chars
        )
        self.max_batch_chars = max_batch_chars

    async def analyze(
        self,
        sources: list[SourceInput],
        output_language: str,
        progress: Progress,
        *,
        checkpoint: Checkpoint | None = None,
        resume: AnalysisOutput | None = None,
    ) -> AnalysisOutput:
        if output_language not in {"ru", "kk", "en"}:
            raise AgentError("Unsupported output language")
        if {source.side for source in sources} != {"before", "after"}:
            raise AgentError("Both document sides need readable sources")
        tools = SourceTools(sources, [])
        prior = resume.model_copy(deep=True) if resume is not None else None
        units: dict[str, UnitOutput] = {item.id: item for item in prior.units} if prior else {}
        functions: dict[str, FunctionOutput] = (
            {item.id: item for item in prior.functions} if prior else {}
        )
        findings: list[FindingOutput] = list(prior.findings) if prior else []
        structure: list[UnitMatchOutput] = list(prior.structure) if prior else []
        errors: list[str] = []
        source_ids = set(tools.sources)
        coverage = dict(prior.coverage) if prior else {}
        processed = set()
        reviewed_before: set[str] = set()
        reviewed_after: set[str] = set()
        classified_after: set[str] = set()
        if prior:
            pending = set(coverage.get("unprocessed_source_ids", source_ids))
            if not pending <= source_ids:
                raise AgentError("Resume coverage cites sources outside the frozen input")
            processed = source_ids - pending
            unreviewed = set(coverage.get("unreviewed_function_ids", functions))
            if not unreviewed <= set(functions):
                raise AgentError("Resume coverage cites unknown functions")
            reviewed_before = {f.id for f in functions.values() if f.side == "before"} - unreviewed
            reviewed_after = {f.id for f in functions.values() if f.side == "after"} - unreviewed
            unclassified = set(coverage.get("unclassified_after_function_ids", functions))
            classified_after = {
                f.id for f in functions.values() if f.side == "after"
            } - unclassified
            tools.operations.extend(prior.operations)
            tools.operations.append({"tool": "resume", "previous_errors": prior.errors})

        def snapshot(*, final=False) -> AnalysisOutput:
            before_ids = {f.id for f in functions.values() if f.side == "before"}
            after_ids = {f.id for f in functions.values() if f.side == "after"}
            mapped_after = {
                fid
                for finding in findings
                if finding.before_function_ids
                for fid in finding.after_function_ids
            }
            covered_units = {
                uid for match in structure for uid in match.before_unit_ids + match.after_unit_ids
            }
            coverage.update(
                total_sources=len(sources),
                processed_sources=len(processed),
                before_functions=len(before_ids),
                compared_before_functions=len(reviewed_before),
                after_functions=len(after_ids),
                reviewed_after_functions=len(reviewed_after),
                classified_after_functions=len((classified_after | mapped_after) & after_ids),
                structure_units=len(units),
                reviewed_structure_units=len(covered_units),
                unprocessed_source_ids=sorted(source_ids - processed),
                unreviewed_function_ids=sorted(
                    (before_ids - reviewed_before) | (after_ids - reviewed_after)
                ),
                unclassified_after_function_ids=sorted(after_ids - classified_after - mapped_after),
            )
            incomplete = (
                not final
                or bool(errors)
                or processed != source_ids
                or before_ids != reviewed_before
                or after_ids != reviewed_after
                or covered_units != set(units)
                or not before_ids
                or not after_ids
                or bool(coverage["unclassified_after_function_ids"])
                or any(not function.owner_unit_ids for function in functions.values())
            )
            return AnalysisOutput(
                units=list(units.values()),
                functions=list(functions.values()),
                findings=list({finding.id: finding for finding in findings}.values()),
                structure=structure,
                coverage=dict(coverage),
                errors=list(errors),
                operations=list(tools.operations),
                partial=incomplete,
            ).model_copy(deep=True)

        async def emit(stage: str) -> None:
            current = snapshot()
            await progress(stage, current.coverage)
            if checkpoint is not None:
                await checkpoint(stage, current)

        namespace = stable_id("source_set", sorted(source_ids))
        for side in ("before", "after"):
            pending_batches = batches(
                [s for s in sources if s.side == side and s.id not in processed],
                max(1, self.max_batch_chars - 80),
            )
            while pending_batches:
                batch = pending_batches.pop(0)
                try:
                    result = await self.model_client.request(
                        prompts.EXTRACT,
                        {
                            "output_language": output_language,
                            "sources": [source.model_dump() for source in batch],
                        },
                        Extraction,
                    )
                    old_catalog = (
                        {key: tuple(value.source_ids) for key, value in functions.items()},
                        {key: (unit.parent_unit_id, tuple(unit.source_ids)) for key, unit in units.items()},
                    )
                    merge_extraction(result, batch, units, functions, namespace)
                    new_catalog = (
                        {key: tuple(value.source_ids) for key, value in functions.items()},
                        {key: (unit.parent_unit_id, tuple(unit.source_ids)) for key, unit in units.items()},
                    )
                    if (
                        old_catalog != new_catalog
                        or (prior is not None and processed != source_ids)
                    ) and (findings or structure or reviewed_before or reviewed_after):
                        tools.operations.append(
                            {
                                "tool": "derived_results_invalidated",
                                "reason": "accepted extraction expanded the catalog",
                                "prior_findings": [item.model_dump() for item in findings],
                                "prior_structure": [item.model_dump() for item in structure],
                            }
                        )
                        findings.clear()
                        structure.clear()
                        reviewed_before.clear()
                        reviewed_after.clear()
                        classified_after.clear()
                    processed.update(source.id for source in batch)
                except OutputLimit as exc:
                    if len(batch) > 1:
                        middle = len(batch) // 2
                        pending_batches[0:0] = [batch[:middle], batch[middle:]]
                        tools.operations.append(
                            {
                                "tool": "split_unaccepted_extraction",
                                "source_ids": [source.id for source in batch],
                            }
                        )
                    else:
                        errors.append(
                            f"Extraction ({side}): {exc}; single source remains unprocessed"
                        )
                except AgentError as exc:
                    errors.append(f"Extraction ({side}): {exc}")
                await emit("extracting")

        tools.functions = list(functions.values())
        before = [function for function in functions.values() if function.side == "before"]
        after = [function for function in functions.values() if function.side == "after"]
        if not before or not after:
            errors.append(
                "No functions extracted on one or both sides; a semantic comparison is incomplete"
            )
        if any(not function.owner_unit_ids for function in functions.values()):
            errors.append("Some function owners are unresolved; human clarification is required")
        covered_units = {
            uid for match in structure for uid in match.before_unit_ids + match.after_unit_ids
        }
        if units and covered_units != set(units):
            try:
                structure = await compare_structure(
                    self.model_client, self.max_batch_chars, units, tools, output_language
                )
            except AgentError as exc:
                errors.append(f"Structure: {exc}")
        await emit("comparing")

        for target_side, target_functions, candidates, prompt in (
            ("before", [f for f in before if f.id not in reviewed_before], after, prompts.COMPARE),
            (
                "after",
                [f for f in after if f.id not in reviewed_after],
                list(functions.values()),
                prompts.AFTER_REVIEW,
            ),
        ):
            for batch in batches(target_functions, self.max_batch_chars // 3):
                stage = "comparing" if target_side == "before" else "checking_risks"
                try:
                    result = await self.model_client.request(
                        prompt,
                        comparison_payload(
                            self.max_batch_chars,
                            batch,
                            candidates,
                            units,
                            output_language,
                            sources=tools.sources,
                        ),
                        Comparison,
                        tools,
                    )
                    expected = {function.id for function in batch}
                    if (
                        len(result.reviewed_function_ids) != len(expected)
                        or set(result.reviewed_function_ids) != expected
                    ):
                        raise AgentError("Comparison did not review the complete target batch")
                    validated = [
                        validate_finding(draft, functions, tools.sources)
                        for draft in result.findings
                    ]
                    for finding in validated:
                        related = (
                            finding.before_function_ids
                            if target_side == "before"
                            else finding.after_function_ids
                        )
                        if not expected.intersection(related):
                            raise AgentError("Finding does not concern this target batch")
                        if target_side == "before" and (
                            finding.change_type == "new"
                            or finding.issue_type in {"overlap", "potential_conflict"}
                        ):
                            raise AgentError("Finding belongs to a different review stage")
                        if target_side == "after" and finding.change_type == "potentially_missing":
                            raise AgentError(
                                "Missing-duty candidates belong to the Before comparison"
                            )
                    if target_side == "before" and not expected <= {
                        fid for finding in validated for fid in finding.before_function_ids
                    }:
                        raise AgentError("Comparison omitted one or more Before functions")
                    unfinished_searches: set[str] = set()
                    if target_side == "before":
                        findings = [
                            item
                            for item in findings
                            if not (
                                item.search
                                and item.search.get("method") == "semantic_all_after_batches"
                                and expected.intersection(item.before_function_ids)
                            )
                        ]
                    for finding in validated:
                        if finding.change_type == "new":
                            continue  # Every unmapped After duty is independently checked below.
                        if finding.change_type == "potentially_missing":
                            await verify_missing(
                                self.model_client,
                                self.max_batch_chars,
                                finding,
                                functions,
                                sources,
                                output_language,
                                processed != source_ids,
                                tools,
                            )
                            if finding.search:
                                errors.extend(
                                    f"Missing-function search: {error}"
                                    for error in finding.search["errors"]
                                )
                                if finding.search["errors"]:
                                    unfinished_searches.update(finding.before_function_ids)
                        findings.append(finding)
                    if target_side == "before":
                        reviewed_before.update(expected - unfinished_searches)
                    else:
                        reviewed_after.update(expected)
                except AgentError as exc:
                    errors.append(f"Function review ({target_side}): {exc}")
                await emit(stage)

        mapped_after = {
            fid
            for finding in findings
            if finding.before_function_ids
            for fid in finding.after_function_ids
        }
        for function in after:
            if function.id in mapped_after | classified_after:
                continue
            finding = FindingOutput(
                id=stable_id("addition_candidate", function.id),
                title="",
                change_type="new",
                issue_type=None,
                before_function_ids=[],
                after_function_ids=[function.id],
                explanation="",
                recommendation="",
                evidence=[
                    EvidenceOutput(source_id=identifier, evidence_role="after")
                    for identifier in function.source_ids
                ],
            )
            await verify_new(
                self.model_client,
                self.max_batch_chars,
                finding,
                functions,
                sources,
                output_language,
                processed != source_ids,
                tools,
            )
            # Replace an incomplete prior search for this target, rather than retaining conflicting claims.
            findings = [
                item
                for item in findings
                if not (
                    item.search
                    and item.search.get("method") == "semantic_all_before_batches"
                    and item.after_function_ids == [function.id]
                )
            ]
            findings.append(finding)
            if finding.search and not finding.search["errors"]:
                classified_after.add(function.id)
            if finding.search:
                errors.extend(f"New-function search: {error}" for error in finding.search["errors"])
            await emit("checking_risks")
        final = snapshot(final=True)
        await progress("validating", final.coverage)
        if checkpoint is not None:
            await checkpoint("validating", final)
        return final
