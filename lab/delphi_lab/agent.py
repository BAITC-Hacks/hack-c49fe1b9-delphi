"""One bounded Responses agent; evidence is resolved from immutable source blocks.

No provider calls happen at import. run_agent saves accepted work in AgentResult
even when the budget, provider or validation stops a later stage. This is a lab
implementation: candidate retrieval is lexical, and coverage is processing
coverage, not measured semantic accuracy.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from collections.abc import Callable
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import (AgentResult, Document, Evidence, Finding, Function, StrictModel,
                     Unit, SourceSearch, StructureChange)
from .costs import RunCosts, warn as warn_costs

_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_LOCALES = {"ru": "Russian", "kk": "Kazakh", "en": "English"}


class _Extraction(StrictModel):
    units: list[Unit]
    functions: list[Function]
    processed_source_ids: list[str]


class _Comparison(StrictModel):
    findings: list[Finding]
    reviewed_function_ids: list[str]
    unmatched_function_ids: list[str]


class _Risks(StrictModel):
    findings: list[Finding]
    reviewed_function_ids: list[str]


class _Structure(StrictModel):
    matches: list[StructureChange]


class _SourceSearch(StrictModel):
    reviewed_source_ids: list[str]
    candidate_source_ids: list[str]


class _TranslatedFinding(StrictModel):
    id: str
    title: str
    explanation: str
    recommendation: str


class _Translation(StrictModel):
    findings: list[_TranslatedFinding]


class _TranslatedStructure(StrictModel):
    id: str
    explanation: str


class _StructureTranslation(StrictModel):
    structure: list[_TranslatedStructure]


class _Stopped(RuntimeError):
    pass


class _OutputLimit(ValueError):
    """Only this known provider reason permits bounded extraction splitting."""


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _id(prefix: str, *parts: Any) -> str:
    return prefix + hashlib.sha256(_dump(parts).encode("utf-8")).hexdigest()[:20]


def _norm(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.casefold()))


def _tokens(text: str) -> set[str]:
    return {word[:7] for word in re.findall(r"\w+", text.casefold()) if len(word) > 2}


def _score(query: str, text: str) -> float:
    left, right = _tokens(query), _tokens(text)
    overlap = len(left & right) / max(1, len(left))
    return overlap + 0.25 * SequenceMatcher(None, _norm(query)[:1000], _norm(text)[:1000]).ratio()


def _function_text(function: Function) -> str:
    return " ".join((function.action, function.object, function.scope, function.condition, function.modality))


def _schema(cls: type[StrictModel]) -> dict:
    """Responses strict schemas require every property, including nullable ones."""
    schema = cls.model_json_schema()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            node.pop("default", None)
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}))
            for item in node.values():
                visit(item)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(schema)
    return schema


def _batches(items: list[dict], limit: int, count: int = 64):
    batch: list[dict] = []
    size = 0
    for item in items:
        item_size = len(_dump(item))
        if item_size > limit:
            if batch:
                yield batch
                batch, size = [], 0
            yield [item]  # Caller records oversized input instead of truncating it.
            continue
        if batch and (size + item_size > limit or len(batch) >= count):
            yield batch
            batch, size = [], 0
        batch.append(item)
        size += item_size
    if batch:
        yield batch


def _tool(name: str, description: str, properties: dict) -> dict:
    return {
        "type": "function", "name": name, "description": description, "strict": True,
        "parameters": {"type": "object", "properties": properties,
                       "required": list(properties), "additionalProperties": False},
    }


_SIDE = {"type": "string", "enum": ["before", "after"]}
_STRING = {"type": "string"}
_TOOLS = [
    _tool("search_clauses", "Lexical search of all blocks on one side; result includes search gaps.", {
        "side": _SIDE, "query": _STRING, "offset": {"type": "integer", "minimum": 0},
        "filters": {"type": "object", "properties": {
            "document_id": {"type": ["string", "null"]},
            "clause_prefix": {"type": ["string", "null"]}},
            "required": ["document_id", "clause_prefix"], "additionalProperties": False}}),
    _tool("get_clause", "Read exact source text and parent context from this run.", {"source_id": _STRING}),
    _tool("get_unit_functions", "Read extracted functions of a known unit on the specified side.", {
        "side": _SIDE, "unit_id": _STRING, "offset": {"type": "integer", "minimum": 0}}),
    _tool("check_references", "Locate numbered internal reference targets; no semantic/legal verdict.", {
        "document_id": _STRING}),
]


class _Runner:
    native_cost_tracking = True

    def __init__(self, documents, model, language, max_calls, max_output_tokens,
                 max_input_chars, max_tool_rounds, timeout_seconds, on_progress, *, run_id=None,
                 resume_result: AgentResult | None = None):
        self.documents = documents
        self.blocks = {block.id: block for doc in documents for block in doc.blocks}
        self.result = resume_result.model_copy(deep=True) if resume_result is not None else AgentResult()
        if resume_result is None:
            self.result.trace.extend({"operation": "document_warnings", "document_id": doc.id,
                                      "parse_status": doc.parse_status, "warnings": doc.warnings}
                                     for doc in documents if doc.warnings)
        self.model, self.language = model, language
        self.max_calls, self.max_output_tokens = max_calls, max_output_tokens
        self.max_input_chars, self.max_tool_rounds = max_input_chars, max_tool_rounds
        self.deadline = time.monotonic() + timeout_seconds
        self.started = time.monotonic()
        self.on_progress = on_progress
        self.calls = 0
        self.prior_elapsed = 0.0
        self.processed: set[str] = set()
        self.compared: set[str] = set()
        self.candidate_reviewed: set[str] = set()
        self.risk_reviewed: set[str] = set()
        self.unmatched_sweeps: dict[str, set[str]] = {}
        self.source_sweeps: dict[str, SourceSearch] = {}
        self.classified_after: set[str] = set()
        self.searches: list[dict] = []
        self.client = None
        self.costs = RunCosts(run_id)
        # A resumed extraction uses smaller batches for the remaining blocks,
        # including a prior response that may have reached the output limit.
        # Prompt, output, tools and retry limits remain the caller's settings.
        self.extraction_batch_count = 8 if resume_result is not None else 16
        if resume_result is not None:
            from .validation import validate_result
            validate_result(self.result, documents)
            previous_model = self.result.usage.get("model")
            if previous_model is not None and previous_model != model:
                raise ValueError("A resumed run must use its original model")
            coverage = self.result.coverage
            before = {f.id for f in self.result.functions if f.side == "before"}
            after = {f.id for f in self.result.functions if f.side == "after"}

            def completed_ids(all_ids, pending_key):
                if pending_key not in coverage:
                    return set()
                pending = set(coverage[pending_key])
                if not pending <= all_ids:
                    raise ValueError(f"Resume coverage contains unknown IDs: {pending_key}")
                return all_ids - pending

            self.processed = completed_ids(set(self.blocks), "unprocessed_source_ids")
            self.compared = completed_ids(before, "unprocessed_before_function_ids")
            self.risk_reviewed = completed_ids(after, "unprocessed_after_risk_function_ids")
            # Old extraction-only snapshots remain readable. New absence claims
            # require raw-source coverage even when a legacy function sweep finished.
            for key, value in coverage.get("source_sweeps", {}).items():
                search = SourceSearch.model_validate(value)
                expected_side = "after" if key in before else "before" if key in after else None
                if search.side != expected_side:
                    raise ValueError("Resume source search has an unknown target or wrong side")
                available = {b.id for b in self.blocks.values() if b.side == search.side}
                if (not set(search.reviewed_source_ids) <= available
                        or not set(search.candidate_source_ids) <= set(search.reviewed_source_ids)):
                    raise ValueError("Resume source search contains unknown or unreviewed sources")
                self.source_sweeps[key] = search.model_copy(update={"errors": [], "complete": False})
            self.classified_after = set(coverage.get("classified_after_function_ids", []))
            if not self.classified_after <= after:
                raise ValueError("Resume classification contains unknown functions")
            legacy_unmatched = {fid for finding in self.result.findings
                                if finding.change_type == "unmatched" and finding.search is None
                                for fid in finding.before_function_ids}
            self.compared.difference_update(legacy_unmatched)
            self.result.findings = [f for f in self.result.findings
                                    if not (f.change_type == "unmatched" and f.search is None)]
            for target, visited in coverage.get("unmatched_sweeps", {}).items():
                if target not in before or not set(visited) <= after:
                    raise ValueError("Resume search coverage contains unknown function IDs")
                self.unmatched_sweeps[target] = set(visited)
            self.candidate_reviewed = set(coverage.get("candidate_reviewed_function_ids", []))
            self.candidate_reviewed.update(self.compared | set(self.unmatched_sweeps))
            if not self.candidate_reviewed <= before:
                raise ValueError("Resume comparison coverage contains unknown function IDs")
            self.calls = int(self.result.usage.get("api_calls", 0))
            self.prior_elapsed = float(self.result.usage.get("elapsed_seconds", 0))
            self.searches = [
                {"side": item["arguments"]["side"], "query": item["arguments"]["query"],
                 "all_side_scanned": item.get("all_side_scanned", False)}
                for item in self.result.trace if item.get("operation") == "search_clauses"
                and "side" in item.get("arguments", {}) and "query" in item.get("arguments", {})
            ]
            self.result.trace.append({"operation": "resume", "previous_errors": list(self.result.errors),
                                      "previous_stage": coverage.get("stage"), "prior_api_calls": self.calls,
                                      "max_calls": max_calls, "timeout_seconds": timeout_seconds})
            self.result.errors = []
            self.result.complete = False

    def checkpoint(self, stage: str) -> None:
        before = [f.id for f in self.result.functions if f.side == "before"]
        after = [f.id for f in self.result.functions if f.side == "after"]
        mapped_after = {key for finding in self.result.findings if finding.before_function_ids
                        for key in finding.after_function_ids}
        structure_reviewed = {uid for match in self.result.structure
                              for uid in match.before_unit_ids + match.after_unit_ids}
        self.result.coverage = {
            "stage": stage, "blocks_total": len(self.blocks),
            "blocks_processed": len(self.processed),
            "unprocessed_source_ids": sorted(set(self.blocks) - self.processed),
            "before_functions_total": len(before), "before_functions_compared": len(self.compared),
            "unprocessed_before_function_ids": sorted(set(before) - self.compared),
            "candidate_reviewed_function_ids": sorted(self.candidate_reviewed),
            "after_functions_total": len(after), "after_functions_risk_reviewed": len(self.risk_reviewed),
            "unprocessed_after_risk_function_ids": sorted(set(after) - self.risk_reviewed),
            "unclassified_after_function_ids": sorted(set(after) - mapped_after - self.classified_after),
            "classified_after_function_ids": sorted(self.classified_after),
            "structure_units_total": sum(u.kind != "role" for u in self.result.units),
            "structure_units_reviewed": len(structure_reviewed),
            "unprocessed_structure_unit_ids": sorted({u.id for u in self.result.units if u.kind != "role"} - structure_reviewed),
            "parse_gaps": [{"document_id": d.id, "status": d.parse_status, "warnings": d.warnings}
                           for d in self.documents if d.parse_status != "ok"],
            "document_warnings": [{"document_id": d.id, "warnings": d.warnings}
                                  for d in self.documents if d.warnings],
            "unmatched_sweeps": {key: sorted(value) for key, value in self.unmatched_sweeps.items()},
            "source_sweeps": {key: value.model_dump() for key, value in self.source_sweeps.items()},
            "search_scope": "semantic batches of every available source on the opposite side; lexical retrieval alone never proves absence",
            "risk_scope": "all extracted After targets with ranked candidates and bounded tools; not an exhaustive pairwise proof",
            "coverage_is_accuracy": False,
        }
        self.result.usage.update(model=self.model, api_calls=self.calls,
                                 elapsed_seconds=round(self.prior_elapsed + time.monotonic() - self.started, 2))
        self.result.usage['cost_tracking'] = self.costs.snapshot()
        if self.on_progress:
            self.on_progress({"stage": stage, "result": self.result.model_dump(mode="json")})

    def check_budget(self) -> None:
        if time.monotonic() >= self.deadline:
            raise _Stopped("Time budget exhausted; accepted partial results retained.")
        if self.calls >= self.max_calls:
            raise _Stopped("API call budget exhausted; accepted partial results retained.")

    def request(self, stage: str, payload: dict, schema: type[StrictModel], tools: bool = False):
        from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI

        if self.client is None:
            self.client = OpenAI(max_retries=0)
        instructions = (_PROMPTS / "system.md").read_text(encoding="utf-8") + "\n" + (
            _PROMPTS / f"{stage}.md").read_text(encoding="utf-8")
        instructions += f"\nOutput explanation language: {_LOCALES[self.language]}."
        conversation: list = [{"role": "user", "content": _dump(payload)}]
        # Initial payload is bounded. Tool continuations have a separate bounded
        # allowance and never silently discard earlier evidence.
        if len(_dump(payload)) > self.max_input_chars:
            raise ValueError(f"{stage}: batch exceeds max_input_chars; no text was truncated")
        for round_no in range(self.max_tool_rounds + 1):
            if len(_dump([x.model_dump(mode="json") if hasattr(x, "model_dump") else x
                          for x in conversation])) > self.max_input_chars * (self.max_tool_rounds + 2):
                raise _Stopped("Tool context budget exhausted; batch left unprocessed.")
            options = {
                "model": self.model, "instructions": instructions, "input": conversation,
                "text": {"format": {"type": "json_schema", "name": schema.__name__,
                                      "strict": True, "schema": _schema(schema)}},
                "max_output_tokens": self.max_output_tokens, "store": False,
                "include": ["reasoning.encrypted_content"],
            }
            if tools:
                options.update(tools=_TOOLS, parallel_tool_calls=False,
                               tool_choice="auto" if round_no < self.max_tool_rounds else "none")
            for attempt in range(2):
                self.check_budget()
                try:
                    self.costs.check_budget(options)
                except ValueError as exc:
                    # No SDK attempt happened: do not count or log a paid call.
                    raise _Stopped(str(exc)) from None
                self.calls += 1
                call_started = time.monotonic()
                try:
                    response, api_error = None, None
                    try:
                        response = self.client.with_options(
                            timeout=max(0.1, min(120, self.deadline - time.monotonic()))
                        ).responses.create(**options)
                    except BaseException as exc:
                        api_error = exc
                        raise
                    finally:
                        elapsed_ms = (time.monotonic() - call_started) * 1000
                        try:
                            self.costs.record(stage, self.model, response, elapsed_ms,
                                              attempt=attempt + 1, round_index=round_no,
                                              call_index=self.calls, error=api_error)
                        except Exception as exc:
                            # A metrics failure must never enter the paid-request retry path.
                            warn_costs(f'Accounting hook failed ({type(exc).__name__}); analysis continues.')
                    break
                except (APIConnectionError, APITimeoutError, APIStatusError) as exc:
                    status = getattr(exc, "status_code", None)
                    transient = status is None or status in (408, 409, 429) or status >= 500
                    self.result.trace.append({"operation": "api_error", "stage": stage,
                                              "type": type(exc).__name__, "http_status": status})
                    if not transient or attempt:
                        raise _Stopped(f"Provider request failed: {type(exc).__name__}, HTTP {status}.") from None
                    time.sleep(min(1, max(0, self.deadline - time.monotonic())))
            usage = getattr(response, "usage", None)
            if usage:
                for key in ("input_tokens", "output_tokens", "total_tokens"):
                    self.result.usage[key] = self.result.usage.get(key, 0) + (getattr(usage, key, 0) or 0)
            self.result.trace.append({"operation": "model_call", "stage": stage, "round": round_no,
                                      "seconds": round(time.monotonic() - call_started, 2),
                                      "status": response.status, "response_id": response.id})
            if response.status != "completed":
                details = getattr(response, "incomplete_details", None)
                reason = details.get("reason") if isinstance(details, dict) else getattr(details, "reason", None)
                # Sanitize provider metadata rather than persisting arbitrary text.
                reason = reason if reason in {"max_output_tokens", "content_filter"} else "unspecified"
                self.result.trace.append({"operation": "incomplete_response", "stage": stage,
                                          "reason": reason, "response_id": response.id})
                if response.status == "incomplete" and reason == "max_output_tokens":
                    raise _OutputLimit(f"{stage}: output token limit; batch not accepted")
                raise ValueError(f"{stage}: provider response is {response.status}; batch not accepted")
            function_calls = [item for item in response.output if item.type == "function_call"]
            if function_calls:
                if round_no >= self.max_tool_rounds:
                    raise _Stopped("Tool round limit exhausted; batch left unprocessed.")
                conversation.extend(response.output)
                for item in function_calls:
                    try:
                        output = self.execute_tool(item.name, json.loads(item.arguments))
                    except (ValueError, KeyError, TypeError) as exc:
                        output = {"error": str(exc)}
                        self.result.trace.append({"operation": "tool_error", "tool": item.name,
                                                  "error": str(exc)})
                    conversation.append({"type": "function_call_output", "call_id": item.call_id,
                                         "output": _dump(output)})
                continue
            if not response.output_text:
                raise ValueError(f"{stage}: empty output or refusal; batch not accepted")
            return schema.model_validate_json(response.output_text)
        raise _Stopped("Tool round limit exhausted.")

    def source(self, source_id: str) -> dict:
        if source_id not in self.blocks:
            raise ValueError(f"Unknown source ID: {source_id}")
        block = self.blocks[source_id]
        parents, seen = [], {source_id}
        parent = block.parent_id
        while parent and parent not in seen:
            seen.add(parent)
            if parent not in self.blocks:
                raise ValueError(f"Unknown parent source ID: {parent}")
            item = self.blocks[parent]
            if item.document_id != block.document_id or item.side != block.side:
                raise ValueError("Parent source belongs to another document or side")
            parents.append({"id": item.id, "text": item.original_text})
            parent = item.parent_id
        return {"id": block.id, "side": block.side, "document_id": block.document_id,
                "clause_no": block.clause_no, "locator": block.locator,
                "text": block.original_text, "parents": parents}

    def execute_tool(self, name: str, args: dict) -> dict:
        started = time.monotonic()
        expected = {"search_clauses": {"side", "query", "filters", "offset"},
                    "get_clause": {"source_id"}, "get_unit_functions": {"side", "unit_id", "offset"},
                    "check_references": {"document_id"}}
        if name not in expected or not isinstance(args, dict):
            raise ValueError("Unknown tool or invalid arguments")
        # offset defaults preserve old saved calls and direct helper callers.
        required = expected[name] - {"offset"}
        if set(args) - expected[name] or not required <= set(args):
            raise ValueError("Invalid tool argument names")
        offset = args.get("offset", 0)
        if type(offset) is not int or offset < 0:
            raise ValueError("Tool offset must be a non-negative integer")
        if name == "search_clauses":
            side, query, filters = args["side"], args["query"], args["filters"]
            if side not in ("before", "after") or not isinstance(query, str) or not query.strip():
                raise ValueError("Search requires a valid side and a nonempty query")
            if not isinstance(filters, dict) or set(filters) - {"document_id", "clause_prefix"}:
                raise ValueError("Unknown search filter")
            doc_id, prefix = filters.get("document_id"), filters.get("clause_prefix")
            if doc_id and not any(d.id == doc_id and d.side == side for d in self.documents):
                raise ValueError("Search document is unknown or on the wrong side")
            corpus = [b for b in self.blocks.values() if b.side == side
                      and (not doc_id or b.document_id == doc_id)
                      and (not prefix or (b.clause_no or "").startswith(prefix))]
            ranked = sorted(corpus, key=lambda b: _score(query, b.normalized_text), reverse=True)
            ranked = [block for block in ranked if _score(query, block.normalized_text) > 0.06]
            matches, chars = [], 0
            for block in ranked[offset:offset + 10]:
                item = self.source(block.id)
                length = len(_dump(item))
                if chars + length > max(2000, self.max_input_chars // 2):
                    if not matches:
                        raise ValueError("Search item exceeds tool output budget; use get_clause or a smaller input source")
                    break
                chars += length
                matches.append(item)
            output = {"matches": matches, "scanned_blocks": len(corpus),
                      "available_side_blocks": sum(b.side == side for b in self.blocks.values()),
                      "all_side_scanned": not doc_id and not prefix,
                      "retrieval": "lexical; ranked results are limited; not semantic absence proof",
                      "offset": offset, "total_matches": len(ranked),
                      "next_offset": offset + len(matches) if offset + len(matches) < len(ranked) else None,
                      "has_more": offset + len(matches) < len(ranked),
                      "input_complete": all(d.parse_status == "ok"
                                            for d in self.documents if d.side == side)}
            self.searches.append({"side": side, "query": query, "all_side_scanned": output["all_side_scanned"]})
        elif name == "get_clause":
            output = self.source(args["source_id"])
            if len(_dump(output)) > self.max_input_chars:
                raise ValueError("Source exceeds tool output budget; it was not truncated")
        elif name == "get_unit_functions":
            unit = next((u for u in self.result.units if u.id == args["unit_id"]), None)
            if unit is None or unit.side != args["side"]:
                raise ValueError("Unknown unit ID or wrong side")
            functions = [f.model_dump() for f in self.result.functions if unit.id in f.owner_unit_ids]
            selected, chars = [], 0
            for function in functions[offset:offset + 20]:
                size = len(_dump(function))
                if chars + size > self.max_input_chars:
                    if not selected:
                        raise ValueError("Function exceeds tool output budget")
                    break
                selected.append(function)
                chars += size
            next_offset = offset + len(selected)
            output = {"functions": selected, "total": len(functions), "offset": offset,
                      "has_more": next_offset < len(functions),
                      "next_offset": next_offset if next_offset < len(functions) else None,
                      "truncated": next_offset < len(functions)}
        elif name == "check_references":
            doc = next((d for d in self.documents if d.id == args["document_id"]), None)
            if doc is None:
                raise ValueError("Unknown document ID")
            targets: dict[str, list[str]] = {}
            for block in doc.blocks:
                if block.clause_no:
                    targets.setdefault(block.clause_no.rstrip("."), []).append(block.id)
            references = []
            for block in doc.blocks:
                for match in re.finditer(r"(?i)(?:пункт\w*|пп?\.|clauses?|sections?|тармақ\w*)\s*(\d+(?:\.\d+)+)", block.original_text):
                    number = match.group(1).rstrip(".")
                    references.append({"source_id": block.id, "reference": number,
                                       "target_ids": targets.get(number, [])})
            output = {"references": references[:60], "total": len(references),
                      "truncated": len(references) > 60, "semantic_check": "not performed by this tool"}
        else:
            raise ValueError(f"Unknown tool: {name}")
        ids = []
        if name == "search_clauses":
            ids = [item["id"] for item in output["matches"]]
        elif name == "get_clause":
            ids = [output["id"]]
        self.result.trace.append({"operation": name, "arguments": args, "source_ids": ids,
                                  "scanned_blocks": output.get("scanned_blocks"),
                                  "all_side_scanned": output.get("all_side_scanned"),
                                  "seconds": round(time.monotonic() - started, 3)})
        return output

    def extraction_batches(self, primary: list[dict], side: str):
        pending = list(_batches(primary, int(self.max_input_chars * 0.62), count=self.extraction_batch_count))
        while pending:
            batch = pending.pop(0)
            primary_ids = {block["id"] for block in batch}
            context = {}
            for block in batch:
                for parent in self.source(block["id"])["parents"]:
                    if parent["id"] not in primary_ids:
                        context[parent["id"]] = parent
            payload = {"side": side, "primary_blocks": batch, "context_blocks": list(context.values())}
            if len(_dump(payload)) > self.max_input_chars and len(batch) > 1:
                middle = len(batch) // 2
                pending[0:0] = [batch[:middle], batch[middle:]]
                continue
            yield batch, primary_ids, primary_ids | set(context), payload

    def extract(self) -> None:
        minimum_calls = sum(len(list(self.extraction_batches([
            {"id": b.id, "text": b.original_text, "kind": b.kind,
             "clause_no": b.clause_no, "parent_id": b.parent_id}
            for b in doc.blocks if b.kind != "toc" and b.id not in self.processed], doc.side)))
            for doc in self.documents)
        self.result.usage["minimum_remaining_extraction_calls_at_start"] = minimum_calls
        self.result.trace.append({"operation": "extraction_plan", "minimum_calls": minimum_calls,
                                  "remaining_call_budget": max(0, self.max_calls - self.calls),
                                  "includes_comparison_structure_risks": False})
        for doc in self.documents:
            # TOC handling is explicit, and its blocks are counted as deliberately
            # skipped structure, not extracted duties.
            toc = [b.id for b in doc.blocks if b.kind == "toc" and b.id not in self.processed]
            self.processed.update(toc)
            if toc:
                self.result.trace.append({"operation": "skip_toc", "source_ids": toc})
            primary = [{"id": b.id, "text": b.original_text, "kind": b.kind,
                        "clause_no": b.clause_no, "parent_id": b.parent_id}
                       for b in doc.blocks if b.kind != "toc" and b.id not in self.processed]
            pending = list(self.extraction_batches(primary, doc.side))
            while pending:
                batch, primary_ids, allowed, payload = pending.pop(0)
                self.check_budget()
                try:
                    parsed = self.request("extract", payload, _Extraction)
                    if set(parsed.processed_source_ids) != primary_ids:
                        raise ValueError("Extraction did not acknowledge exactly all primary source IDs")
                    local_units: dict[str, str] = {}
                    accepted_units = []
                    for unit in parsed.units:
                        self.validate_sources(unit.source_ids, doc.side, allowed)
                        if unit.side != doc.side or unit.id in local_units or not unit.name_original.strip():
                            raise ValueError("Unit side or duplicate local unit ID is invalid")
                        stable = _id("u_", doc.side, unit.kind, _norm(unit.name_original))
                        local_units[unit.id] = stable
                        accepted_units.append(unit.model_copy(update={"id": stable}))
                    for original, accepted in zip(parsed.units, accepted_units):
                        parent = original.parent_unit_id
                        if parent is not None and (parent not in local_units or parent == original.id):
                            raise ValueError("Unit parent is unknown or refers to itself")
                        accepted.parent_unit_id = local_units[parent] if parent is not None else None
                    accepted_functions = []
                    for function in parsed.functions:
                        self.validate_sources(function.source_ids, doc.side, allowed)
                        if function.side != doc.side or not primary_ids.intersection(function.source_ids) or not function.action.strip():
                            raise ValueError("Function side or primary evidence is invalid")
                        if any(owner not in local_units for owner in function.owner_unit_ids):
                            raise ValueError("Function refers to an unknown owner unit")
                        owners = sorted({local_units[owner] for owner in function.owner_unit_ids})
                        stable = _id("fn_", doc.side, sorted(function.source_ids), owners,
                                     function.action, function.object, function.scope, function.condition, function.modality)
                        accepted_functions.append(function.model_copy(update={"id": stable, "owner_unit_ids": owners}))
                    # Commit a batch only after the entire response validates.
                    units = {unit.id: unit for unit in self.result.units}
                    for unit in accepted_units:
                        if unit.id in units:
                            previous = units[unit.id]
                            if (previous.parent_unit_id and unit.parent_unit_id
                                    and previous.parent_unit_id != unit.parent_unit_id):
                                raise ValueError("Unit has inconsistent extracted parents")
                            unit = unit.model_copy(update={
                                "source_ids": sorted(set(unit.source_ids + previous.source_ids)),
                                "parent_unit_id": unit.parent_unit_id or previous.parent_unit_id})
                        units[unit.id] = unit
                    for unit in units.values():
                        seen, current = set(), unit
                        while current.parent_unit_id:
                            if current.id in seen or current.parent_unit_id not in units:
                                raise ValueError("Unit hierarchy contains a cycle or unknown parent")
                            seen.add(current.id)
                            current = units[current.parent_unit_id]
                    functions = {f.id: f for f in self.result.functions}
                    functions.update({f.id: f for f in accepted_functions})
                    self.result.units, self.result.functions = list(units.values()), list(functions.values())
                    self.processed.update(primary_ids)
                except _OutputLimit as exc:
                    if len(batch) > 1:
                        middle = len(batch) // 2
                        children = list(self.extraction_batches(batch[:middle], doc.side))
                        children += list(self.extraction_batches(batch[middle:], doc.side))
                        pending[0:0] = children
                        self.result.trace.append({"operation": "split_unaccepted_extraction",
                                                  "source_ids": sorted(primary_ids), "reason": "max_output_tokens",
                                                  "children": len(children)})
                    else:
                        self.result.errors.append(f"Extraction {doc.id}/{batch[0]['id']}: {exc}; one source cannot be split safely")
                except (ValueError, ValidationError) as exc:
                    self.result.errors.append(f"Extraction batch {doc.id}/{batch[0]['id']}: {exc}")
                self.checkpoint("extract")

    def validate_sources(self, ids: list[str], side: str, allowed: set[str] | None = None) -> None:
        if not ids:
            raise ValueError("Evidence source list is empty")
        for source_id in ids:
            block = self.blocks.get(source_id)
            if block is None or block.side != side or (allowed is not None and source_id not in allowed):
                raise ValueError(f"Unknown, wrong-side or out-of-batch source ID: {source_id}")

    def validate_finding(self, finding: Finding, *, risk: bool = False) -> Finding:
        functions = {f.id: f for f in self.result.functions}
        if finding.search is not None:
            raise ValueError("Model findings cannot invent source-search coverage")
        for side, ids in (("before", finding.before_function_ids), ("after", finding.after_function_ids)):
            if len(ids) != len(set(ids)) or any(key not in functions or functions[key].side != side for key in ids):
                raise ValueError("Finding uses an unknown or wrong-side function ID")
        if not finding.evidence:
            raise ValueError("Finding has no evidence")
        before_sources, after_sources = set(), set()
        connected = {source for fid in finding.before_function_ids + finding.after_function_ids
                     for source in functions[fid].source_ids}
        for evidence in finding.evidence:
            block = self.blocks.get(evidence.source_id)
            if block is None:
                raise ValueError(f"Finding uses unknown source ID: {evidence.source_id}")
            if evidence.evidence_role != "context" and evidence.evidence_role != block.side:
                raise ValueError("Finding evidence role is on the wrong side")
            if evidence.evidence_role != "context" and evidence.source_id not in connected:
                raise ValueError("Finding evidence is unrelated to its functions")
            start, end = evidence.start_offset, evidence.end_offset
            if (start is None) != (end is None) or (start is not None and not (0 <= start < end <= len(block.original_text))):
                raise ValueError("Invalid original-text evidence offsets")
            if evidence.evidence_role != "context":
                (before_sources if block.side == "before" else after_sources).add(block.id)
        evidence_ids = {item.source_id for item in finding.evidence}
        if any(not evidence_ids.intersection(functions[fid].source_ids)
               for fid in finding.before_function_ids + finding.after_function_ids):
            raise ValueError("Every referenced function must contribute evidence")
        if risk:
            if finding.issue_type not in ("overlap", "conflict") or finding.change_type != "review":
                raise ValueError("Risk pass emitted an unsupported finding type")
            if finding.before_function_ids or len(set(finding.after_function_ids)) < 2 or len(after_sources) < 2:
                raise ValueError("Overlap/conflict requires two After functions and distinct After sources")
        elif finding.change_type not in ("preserved", "rephrased", "transferred", "split", "merged", "review"):
            raise ValueError("Comparison cannot declare added or unmatched directly")
        elif not finding.before_function_ids or not finding.after_function_ids or not before_sources or not after_sources:
            raise ValueError("Mapping requires valid functions and evidence on both sides")
        elif finding.issue_type not in ("none", "scope_changed", "modality_changed", "uncertainty"):
            raise ValueError("A comparison cannot declare a gap, overlap or conflict outside its dedicated pass")
        if finding.change_type == "split" and (len(finding.before_function_ids) != 1 or len(set(finding.after_function_ids)) < 2):
            raise ValueError("A split requires multiple After functions")
        if finding.change_type == "merged" and (len(finding.after_function_ids) != 1 or len(set(finding.before_function_ids)) < 2):
            raise ValueError("A merge requires multiple Before functions")
        actual_queries = {search["query"] for search in self.searches}
        if any(query not in actual_queries for query in finding.search_queries):
            raise ValueError("Finding claimed a search that was never executed")
        return finding.model_copy(update={"id": _id("f_", finding.change_type, finding.issue_type,
                                                    sorted(finding.before_function_ids), sorted(finding.after_function_ids))})

    def accept_findings(self, findings: list[Finding], *, risk: bool = False,
                        target_ids: set[str] | None = None) -> None:
        valid = [self.validate_finding(finding, risk=risk) for finding in findings]
        if target_ids is not None and any(not target_ids.intersection(
                f.after_function_ids if risk else f.before_function_ids) for f in valid):
            raise ValueError("Finding is unrelated to the current target batch")
        current = {f.id: f for f in self.result.findings}
        current.update({f.id: f for f in valid})
        self.result.findings = list(current.values())

    def payload(self, targets: list[Function], candidates: list[Function], mode: str) -> dict:
        selected = {f.id: f for f in targets + candidates}
        source_ids = {source for function in selected.values() for source in function.source_ids}
        return {"mode": mode, "target_function_ids": [f.id for f in targets],
                "before_functions": [f.model_dump() for f in selected.values() if f.side == "before"],
                "after_functions": [f.model_dump() for f in selected.values() if f.side == "after"],
                "sources": [self.source(key) for key in sorted(source_ids)],
                "available_before_count": sum(f.side == "before" for f in self.result.functions),
                "available_after_count": sum(f.side == "after" for f in self.result.functions)}

    def candidates(self, targets: list[Function], pool: list[Function], mode: str) -> list[Function]:
        target_ids = {f.id for f in targets}
        ranked = sorted((f for f in pool if f.id not in target_ids),
                        key=lambda f: max(_score(_function_text(t), _function_text(f)) for t in targets), reverse=True)
        chosen = []
        for function in ranked[:12]:
            if len(_dump(self.payload(targets, chosen + [function], mode))) <= self.max_input_chars:
                chosen.append(function)
        return chosen

    def target_batches(self, functions: list[Function], mode: str):
        batch = []
        for function in functions:
            if batch and (len(batch) >= 4 or len(_dump(self.payload(batch + [function], [], mode))) > self.max_input_chars * 0.45):
                yield batch
                batch = []
            batch.append(function)
        if batch:
            yield batch

    def structure(self) -> None:
        """Review the entire unit/group catalog; roles remain attached to duties."""
        units = {u.id: u for u in self.result.units if u.kind != "role"}
        covered = {uid for row in self.result.structure for uid in row.before_unit_ids + row.after_unit_ids}
        if not covered <= set(units):
            raise ValueError("Saved structure contains an unknown unit")
        remaining = [u for u in units.values() if u.id not in covered]
        groups: dict[tuple, dict[str, list[Unit]]] = {}
        all_units = {u.id: u for u in self.result.units}
        for unit in remaining:
            parent = all_units.get(unit.parent_unit_id)
            signature = (unit.kind, _norm(unit.name_original),
                         None if parent is None else (parent.kind, _norm(parent.name_original)))
            groups.setdefault(signature, {"before": [], "after": []})[unit.side].append(unit)
        explanation = {
            "ru": "Наименование, тип и указанный родитель совпадают. Это не означает неизменность обязанностей.",
            "kk": "Атауы, түрі және көрсетілген бағыныстылығы сәйкес. Бұл міндеттер өзгермеді дегенді білдірмейді.",
            "en": "The name, kind and recorded parent match. This does not establish unchanged duties.",
        }[self.language]
        for group in groups.values():
            if len(group["before"]) == len(group["after"]) == 1:
                before, after = group["before"][0], group["after"][0]
                self.result.structure.append(StructureChange(
                    id=_id("s_", before.id, after.id), before_unit_ids=[before.id], after_unit_ids=[after.id],
                    status="retained", source_ids=sorted(set(before.source_ids + after.source_ids)),
                    explanation=explanation))
                covered.update((before.id, after.id))
        remaining = [u for u in units.values() if u.id not in covered]
        self.checkpoint("structure")
        if not remaining:
            return
        payload = {"units": [{**u.model_dump(), "source_ids": u.source_ids[:3],
                               "total_source_ids": len(u.source_ids)} for u in remaining],
                   "already_matched_unit_ids": sorted(covered)}
        try:
            parsed = self.request("structure", payload, _Structure, tools=True)
            expected, seen, staged = {u.id for u in remaining}, set(), []
            for row in parsed.matches:
                ids = row.before_unit_ids + row.after_unit_ids
                if not ids or len(ids) != len(set(ids)) or seen.intersection(ids) or not set(ids) <= expected:
                    raise ValueError("Structure repeats or invents unit IDs")
                for side, keys in (("before", row.before_unit_ids), ("after", row.after_unit_ids)):
                    if any(units[key].side != side for key in keys):
                        raise ValueError("Structure cites a unit on the wrong side")
                if not row.source_ids or any(key not in self.blocks for key in row.source_ids):
                    raise ValueError("Structure source evidence is empty or unknown")
                if any(not set(units[key].source_ids).intersection(row.source_ids) for key in ids):
                    raise ValueError("Every structure unit must contribute evidence")
                if row.status in {"retained", "transformed"} and not (row.before_unit_ids and row.after_unit_ids):
                    raise ValueError("Mapped structure requires both sides")
                if row.status == "newly_listed" and (row.before_unit_ids or not row.after_unit_ids):
                    raise ValueError("Newly listed structure requires only After units")
                if row.status == "unmatched" and (not row.before_unit_ids or row.after_unit_ids):
                    raise ValueError("Unmatched structure requires only Before units")
                seen.update(ids)
                staged.append(row.model_copy(update={"id": _id("s_", row.status, sorted(ids))}))
            if seen != expected:
                raise ValueError("Structure did not cover every remaining unit")
            self.result.structure.extend(staged)
        except (ValueError, ValidationError) as exc:
            self.result.errors.append(f"Structure: {exc}")
        self.checkpoint("structure")

    def search_sources(self, function: Function, side: str) -> SourceSearch:
        """Inspect original body blocks, including duties extraction may have omitted."""
        state = self.source_sweeps.setdefault(function.id, SourceSearch(side=side))
        reviewed, candidates = set(state.reviewed_source_ids), set(state.candidate_source_ids)
        sources = [self.source(b.id) for b in self.blocks.values() if b.side == side and b.kind != "toc"]
        available = {item["id"] for item in sources}
        if not reviewed <= available or not candidates <= reviewed:
            raise ValueError("Saved source-search coverage is invalid")
        errors = []
        target_sources = [self.source(key) for key in function.source_ids]
        pending = list(_batches([item for item in sources if item["id"] not in reviewed],
                                max(1, int(self.max_input_chars * 0.5)), count=16))
        while pending:
            batch = pending.pop(0)
            payload = {"function": function.model_dump(), "target_sources": target_sources,
                       "search_side": side, "sources": batch}
            if len(_dump(payload)) > self.max_input_chars and len(batch) > 1:
                middle = len(batch) // 2
                pending[0:0] = [batch[:middle], batch[middle:]]
                continue
            self.check_budget()
            try:
                result = self.request("source_search", payload, _SourceSearch)
                expected = {item["id"] for item in batch}
                if (len(result.reviewed_source_ids) != len(set(result.reviewed_source_ids))
                        or set(result.reviewed_source_ids) != expected
                        or not set(result.candidate_source_ids) <= expected):
                    raise ValueError("Semantic source search has unknown or unreviewed IDs")
                reviewed.update(expected)
                candidates.update(result.candidate_source_ids)
            except (ValueError, ValidationError) as exc:
                errors.append(f"Source search {function.id}: {exc}")
            state.reviewed_source_ids = sorted(reviewed)
            state.candidate_source_ids = sorted(candidates)
            state.errors = list(errors)
            state.complete = False
            self.checkpoint("source_search")
        state.complete = (not errors and reviewed == available and bool(function.owner_unit_ids)
                          and all(d.parse_status == "ok" for d in self.documents))
        self.result.errors.extend(errors)
        self.result.trace.append({"operation": "semantic_source_search", "function_id": function.id,
                                  "side": side, "reviewed_sources": len(reviewed), "complete": state.complete,
                                  "candidate_source_ids": sorted(candidates)})
        return state

    def compare(self) -> None:
        before = [f for f in self.result.functions if f.side == "before"]
        after = [f for f in self.result.functions if f.side == "after"]
        unresolved = [f for f in before if f.id in self.candidate_reviewed and f.id not in self.compared]
        for targets in self.target_batches([f for f in before if f.id not in self.candidate_reviewed], "candidates"):
            self.check_budget()
            target_ids = {target.id for target in targets}
            candidates = self.candidates(targets, after, "candidates")
            try:
                parsed = self.request("compare", self.payload(targets, candidates, "candidates"), _Comparison, tools=True)
                if set(parsed.reviewed_function_ids) != target_ids or set(parsed.unmatched_function_ids) - target_ids:
                    raise ValueError("Comparison coverage IDs do not match target IDs")
                mapped_ids = {fid for finding in parsed.findings for fid in finding.before_function_ids}
                if (target_ids - mapped_ids != set(parsed.unmatched_function_ids)
                        or mapped_ids.intersection(parsed.unmatched_function_ids)):
                    raise ValueError("Each target must be mapped or unresolved exactly once")
                self.accept_findings(parsed.findings, target_ids=target_ids)
                self.candidate_reviewed.update(target_ids)
                for target in targets:
                    mapped = any(target.id in f.before_function_ids for f in parsed.findings)
                    if mapped:
                        self.compared.add(target.id)
                    else:
                        unresolved.append(target)
            except (ValueError, ValidationError) as exc:
                self.result.errors.append(f"Comparison {sorted(target_ids)}: {exc}")
            self.checkpoint("compare")
        # Lexical/extracted-function misses do not prove absence. Inspect every
        # original opposite-side body source, including non-extracted duties.
        for target in unresolved:
            query = _function_text(target)
            self.execute_tool("search_clauses", {"side": "after", "query": query,
                                               "filters": {"document_id": None, "clause_prefix": None}})
            try:
                search = self.search_sources(target, "after")
            except _Stopped:
                self.add_unresolved(target, query, False, self.source_sweeps.get(target.id, SourceSearch(side="after")))
                self.checkpoint("search_unmatched")
                raise
            self.add_unresolved(target, query, search.complete and not search.candidate_source_ids, search)
            available = {b.id for b in self.blocks.values() if b.side == "after" and b.kind != "toc"}
            if set(search.reviewed_source_ids) == available and not search.errors:
                self.compared.add(target.id)
            self.checkpoint("search_unmatched")

    def add_unresolved(self, function: Function, query: str, complete: bool,
                       search: SourceSearch | None = None) -> None:
        texts = {
            "ru": ("Соответствие не найдено в предоставленном комплекте", "Недостаточно данных для вывода о соответствии",
                   "Семантически проверены все доступные исходные пункты «После». Это не доказывает прекращение работы вне комплекта документов.",
                   "Есть пробелы чтения или извлечения. Нельзя заключать, что обязанность утрачена.",
                   "Уточните исполнителя и полноту документов у ответственного сотрудника."),
            "kk": ("Берілген құжаттар жиынтығында сәйкестік табылмады", "Сәйкестікті анықтау үшін дерек жеткіліксіз",
                   "Қолжетімді «Кейін» бастапқы тармақтарының барлығы тексерілді. Бұл құжаттардан тыс жұмыс тоқтатылғанын дәлелдемейді.",
                   "Оқу немесе дерек алу толық емес. Міндет жоғалды деген қорытынды жасауға болмайды.",
                   "Орындаушыны және құжаттардың толықтығын жауапты қызметкерден нақтылаңыз."),
            "en": ("No counterpart found in the provided document set", "Insufficient evidence to determine correspondence",
                   "Every available original After body source was semantically reviewed. This does not prove work ceased outside the provided documents.",
                   "Parsing or extraction has gaps. A lost duty cannot be concluded.",
                   "Ask the responsible employee to clarify the owner and completeness of the documents."),
        }[self.language]
        finding = Finding(id=_id("f_", "unmatched", function.id), title=texts[0 if complete else 1],
                          change_type="unmatched" if complete else "review", issue_type="gap" if complete else "uncertainty",
                          before_function_ids=[function.id], after_function_ids=[],
                          explanation=texts[2 if complete else 3], recommendation=texts[4],
                          evidence=[Evidence(source_id=key, evidence_role="before") for key in function.source_ids],
                          search_queries=[query], search=search.model_copy(deep=True) if search else None)
        if search and search.candidate_source_ids:
            finding.explanation = {
                "ru": "В исходных пунктах «После» найдены возможные соответствия. Связь функций требует проверки; потеря обязанности не установлена.",
                "kk": "«Кейін» дереккөздерінен ықтимал сәйкестіктер табылды. Функциялар байланысын тексеру қажет; міндеттің жоғалғаны анықталған жоқ.",
                "en": "Possible counterparts were found in original After sources. The mapping needs review; a lost duty is not established.",
            }[self.language]
            finding.evidence.extend(Evidence(source_id=key, evidence_role="context") for key in search.candidate_source_ids)
        current = {f.id: f for f in self.result.findings}
        current[finding.id] = finding
        self.result.findings = list(current.values())

    def additions(self) -> None:
        mapped = {fid for row in self.result.findings if row.before_function_ids for fid in row.after_function_ids}
        for function in self.result.functions:
            if function.side != "after" or function.id in mapped | self.classified_after:
                continue
            search = self.search_sources(function, "before")
            added = search.complete and not search.candidate_source_ids
            titles = {"ru": ("Обязанность впервые указана в комплекте «После»", "Происхождение обязанности требует проверки"),
                      "kk": ("Міндет «Кейін» жиынтығында алғаш көрсетілген", "Міндеттің шығу тегін тексеру қажет"),
                      "en": ("Duty first listed in the supplied After set", "Duty provenance needs review")}
            explanations = {
                "ru": "Проверены доступные исходные пункты «До». Отсутствие соответствия в комплекте не доказывает дату появления работы.",
                "kk": "Қолжетімді «Бұрын» дереккөздері тексерілді. Жиынтықта сәйкестіктің болмауы жұмыстың басталу уақытын дәлелдемейді.",
                "en": "Available original Before sources were checked. Absence of a counterpart does not establish when the work began.",
            }
            finding = Finding(id=_id("f_", "addition_review", function.id), title=titles[self.language][0 if added else 1],
                change_type="added" if added else "review", issue_type="none" if added else "uncertainty",
                before_function_ids=[], after_function_ids=[function.id], explanation=explanations[self.language],
                recommendation={"ru": "Подтвердите исполнителя и полноту источников.", "kk": "Орындаушыны және дереккөздердің толықтығын растаңыз.",
                                "en": "Confirm the owner and completeness of sources."}[self.language],
                evidence=[Evidence(source_id=key, evidence_role="after") for key in function.source_ids]
                         + [Evidence(source_id=key, evidence_role="context") for key in search.candidate_source_ids],
                search=search.model_copy(deep=True))
            current = {f.id: f for f in self.result.findings}
            current[finding.id] = finding
            self.result.findings = list(current.values())
            available = {b.id for b in self.blocks.values() if b.side == "before" and b.kind != "toc"}
            if set(search.reviewed_source_ids) == available and not search.errors:
                self.classified_after.add(function.id)
            self.checkpoint("additions")

    def risks(self) -> None:
        after = [f for f in self.result.functions if f.side == "after"]
        for targets in self.target_batches([f for f in after if f.id not in self.risk_reviewed], "after_risks"):
            self.check_budget()
            target_ids = {target.id for target in targets}
            candidates = self.candidates(targets, after, "after_risks")
            try:
                parsed = self.request("risks", self.payload(targets, candidates, "after_risks"), _Risks, tools=True)
                if set(parsed.reviewed_function_ids) != target_ids:
                    raise ValueError("Risk coverage IDs do not match target IDs")
                self.accept_findings(parsed.findings, risk=True, target_ids=target_ids)
                self.risk_reviewed.update(target_ids)
            except (ValueError, ValidationError) as exc:
                self.result.errors.append(f"Risk pass {sorted(target_ids)}: {exc}")
            self.checkpoint("risks")


def run_agent(documents: list[Document], *, model: str, language: str = "ru",
              max_calls: int = 40, max_output_tokens: int = 5000,
              max_input_chars: int = 16000, max_tool_rounds: int = 4,
              timeout_seconds: int = 900, on_progress: Callable | None = None,
              run_id: str | None = None, resume_result: AgentResult | None = None) -> AgentResult:
    """Run the real provider pipeline. Missing key returns an explicit partial result."""
    if language not in _LOCALES:
        raise ValueError("language must be ru, kk or en")
    if not model or min(max_calls, max_output_tokens, max_input_chars, timeout_seconds) <= 0 or max_tool_rounds < 0:
        raise ValueError("Model and positive execution limits are required")
    runner = _Runner(documents, model, language, max_calls, max_output_tokens,
                     max_input_chars, max_tool_rounds, timeout_seconds, on_progress, run_id=run_id,
                     resume_result=resume_result)
    try:
        all_blocks = [block for document in documents for block in document.blocks]
        if len(runner.blocks) != len(all_blocks) or len({d.id for d in documents}) != len(documents):
            raise ValueError("Document/source IDs must be unique within a run")
        if any(block.document_id != doc.id or block.side != doc.side for doc in documents for block in doc.blocks):
            raise ValueError("Source document ID or side does not match its document")
        if not all(any(d.side == side and d.blocks for d in documents) for side in ("before", "after")):
            raise ValueError("Readable Before and After documents are required")
        if not os.environ.get("OPENAI_API_KEY"):
            raise _Stopped("OPENAI_API_KEY is not configured; no AI analysis was performed.")
        runner.extract()
        runner.structure()
        runner.compare()
        runner.risks()
        runner.additions()
        before = {f.id for f in runner.result.functions if f.side == "before"}
        after = {f.id for f in runner.result.functions if f.side == "after"}
        if not before or not after:
            runner.result.errors.append("No functions extracted on one side; semantic completeness cannot be established.")
        if any(not f.owner_unit_ids for f in runner.result.functions):
            runner.result.errors.append("Some function owners are unresolved; human clarification is required.")
        structure_units = {u.id for u in runner.result.units if u.kind != "role"}
        reviewed_units = {uid for row in runner.result.structure for uid in row.before_unit_ids + row.after_unit_ids}
        mapped_after = {fid for row in runner.result.findings if row.before_function_ids for fid in row.after_function_ids}
        runner.result.complete = (not runner.result.errors and runner.processed == set(runner.blocks)
                                  and before == runner.compared and after == runner.risk_reviewed
                                  and structure_units == reviewed_units
                                  and after <= mapped_after | runner.classified_after
                                  and all(d.parse_status == "ok" for d in documents))
    except (_Stopped, ValueError, ValidationError) as exc:
        runner.result.errors.append(str(exc))
    except Exception as exc:
        # SDK/configuration exceptions must not leak keys or raw request bodies.
        runner.result.errors.append(f"Agent stopped: {type(exc).__name__}. Accepted partial results retained.")
    finally:
        runner.checkpoint("completed" if runner.result.complete else "partial")
        if runner.client is not None:
            runner.client.close()
    return runner.result


def translate_result(result: AgentResult, locale: str, model: str, *, run_id: str | None = None) -> dict:
    """Translate prose only; caller caches by run, review revision and locale.

    Any failed batch raises instead of returning a silently incomplete translation.
    Original source quotations and human reviews never enter the translation API.
    """
    if locale not in _LOCALES:
        raise ValueError("locale must be ru, kk or en")
    if not os.environ.get("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY is not configured")
    runner = _Runner([], model, locale, 40, 5000, 16000, 0, 600, None, run_id=run_id)
    translated = []
    try:
        items = [{"id": f.id, "title": f.title, "explanation": f.explanation,
                  "recommendation": f.recommendation} for f in result.findings]
        for batch in _batches(items, 12000, count=15):
            parsed = runner.request("translation", {"locale": locale, "findings": batch}, _Translation)
            expected = {item["id"] for item in batch}
            actual = [item.id for item in parsed.findings]
            if len(actual) != len(expected) or set(actual) != expected:
                raise ValueError("Translation changed the finding ID set")
            translated.extend(item.model_dump() for item in parsed.findings)
        runner.result.usage.update(model=model, api_calls=runner.calls,
                                  elapsed_seconds=round(time.monotonic() - runner.started, 2))
        runner.result.usage['cost_tracking'] = runner.costs.snapshot()
        return {"locale": locale, "findings": translated, "usage": runner.result.usage,
                "draft": locale == "kk"}
    finally:
        if runner.client is not None:
            runner.client.close()
