from collections.abc import Awaitable, Callable

from openai import AsyncOpenAI

from . import prompts
from .common import batches, stable_id
from .extraction import merge_extraction
from .matching import comparison_payload
from .missing import verify_missing
from .model_client import ModelClient
from .models import (
    AgentError,
    AnalysisOutput,
    Comparison,
    Extraction,
    FindingOutput,
    FunctionOutput,
    SourceInput,
    UnitMatchOutput,
    UnitOutput,
)
from .structure import compare_structure
from .tools import SourceTools
from .validation import validate_finding

Progress = Callable[[str, dict], Awaitable[None]]


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
        self.model_client = ModelClient(client, model, request_timeout_seconds, max_tool_rounds)
        self.max_batch_chars = max_batch_chars

    async def analyze(
        self, sources: list[SourceInput], output_language: str, progress: Progress
    ) -> AnalysisOutput:
        if output_language not in {"ru", "kk", "en"}:
            raise AgentError("Unsupported output language")
        if {source.side for source in sources} != {"before", "after"}:
            raise AgentError("Both document sides need readable sources")
        tools = SourceTools(sources, [])
        units: dict[str, UnitOutput] = {}
        functions: dict[str, FunctionOutput] = {}
        findings: list[FindingOutput] = []
        structure: list[UnitMatchOutput] = []
        errors: list[str] = []
        coverage = {
            "total_sources": len(sources),
            "processed_sources": 0,
            "before_functions": 0,
            "compared_before_functions": 0,
            "after_functions": 0,
            "reviewed_after_functions": 0,
            "structure_units": 0,
            "reviewed_structure_units": 0,
            "unprocessed_source_ids": [],
            "unreviewed_function_ids": [],
        }
        processed: set[str] = set()
        namespace = stable_id("source_set", sorted(source.id for source in sources))
        for side in ("before", "after"):
            for batch in batches(
                [source for source in sources if source.side == side], self.max_batch_chars
            ):
                try:
                    result = await self.model_client.request(
                        prompts.EXTRACT,
                        {
                            "output_language": output_language,
                            "sources": [source.model_dump() for source in batch],
                        },
                        Extraction,
                    )
                    merge_extraction(result, batch, units, functions, namespace)
                    processed.update(source.id for source in batch)
                except AgentError as exc:
                    errors.append(f"Extraction ({side}): {exc}")
                coverage["processed_sources"] = len(processed)
                await progress("extracting", dict(coverage))
        coverage["unprocessed_source_ids"] = [
            source.id for source in sources if source.id not in processed
        ]
        tools.functions = list(functions.values())
        before = [function for function in functions.values() if function.side == "before"]
        after = [function for function in functions.values() if function.side == "after"]
        coverage.update(
            before_functions=len(before), after_functions=len(after), structure_units=len(units)
        )
        if not before or not after:
            errors.append(
                "No functions extracted on one or both sides; a semantic comparison is incomplete"
            )
        if units:
            try:
                structure = await compare_structure(
                    self.model_client, self.max_batch_chars, units, tools, output_language
                )
                coverage["reviewed_structure_units"] = len(
                    {
                        unit_id
                        for match in structure
                        for unit_id in match.before_unit_ids + match.after_unit_ids
                    }
                )
            except AgentError as exc:
                errors.append(f"Structure: {exc}")
        await progress("comparing", dict(coverage))
        reviewed_before: set[str] = set()
        reviewed_after: set[str] = set()
        if before and after:
            for target_side, target_functions, candidates, prompt in (
                ("before", before, after, prompts.COMPARE),
                ("after", after, list(functions.values()), prompts.AFTER_REVIEW),
            ):
                for batch in batches(target_functions, self.max_batch_chars // 3):
                    try:
                        result = await self.model_client.request(
                            prompt,
                            comparison_payload(
                                self.max_batch_chars, batch, candidates, units, output_language
                            ),
                            Comparison,
                            tools,
                        )
                        expected = {function.id for function in batch}
                        if set(result.reviewed_function_ids) != expected:
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
                        if target_side == "before":
                            represented = {
                                function_id
                                for finding in validated
                                for function_id in finding.before_function_ids
                            }
                            if not expected <= represented:
                                raise AgentError("Comparison omitted one or more Before functions")
                        for finding in validated:
                            if finding.change_type == "potentially_missing":
                                await verify_missing(
                                    self.model_client,
                                    self.max_batch_chars,
                                    finding,
                                    functions,
                                    sources,
                                    output_language,
                                    bool(errors),
                                    tools,
                                )
                                if finding.search and finding.search["errors"]:
                                    errors.extend(
                                        f"Missing-function search: {error}"
                                        for error in finding.search["errors"]
                                    )
                            findings.append(finding)
                        if target_side == "before":
                            reviewed_before.update(expected)
                        else:
                            reviewed_after.update(expected)
                    except AgentError as exc:
                        errors.append(f"Function review ({target_side}): {exc}")
                    coverage["compared_before_functions"] = len(reviewed_before)
                    coverage["reviewed_after_functions"] = len(reviewed_after)
                    await progress(
                        "comparing" if target_side == "before" else "checking_risks", dict(coverage)
                    )
        coverage["unreviewed_function_ids"] = [
            function.id
            for function in before + after
            if function.id not in reviewed_before | reviewed_after
        ]
        unique = {finding.id: finding for finding in findings}
        await progress("validating", dict(coverage))
        return AnalysisOutput(
            units=list(units.values()),
            functions=list(functions.values()),
            findings=list(unique.values()),
            structure=structure,
            coverage=coverage,
            errors=errors,
            operations=tools.operations,
            partial=bool(errors),
        )
