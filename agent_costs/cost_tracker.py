"""Cost estimates, usage accounting and timings. Core uses Python 3.10+ stdlib.

Amounts are Decimal USD serialized as strings. No prompts, responses or keys
are persisted in the accounting log. See README.md for scope and assumptions.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from pathlib import Path
import statistics
import sys
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


MODELS_URL = "https://openrouter.ai/api/v1/models"
CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
ROOT = Path(__file__).resolve().parent
ZERO = Decimal("0")
TOKEN_FIELDS = ("input_tokens", "cached_tokens", "cache_write_tokens",
                "output_tokens", "reasoning_tokens")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def decimal(value: Any, name: str = "amount") -> Decimal:
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"{name} must be a finite non-negative number") from exc
    if not result.is_finite() or result < 0:
        raise ValueError(f"{name} must be a finite non-negative number")
    return result


def count(value: Any, name: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def dollars(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), parse_float=Decimal)


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str, allow_nan=False)


def output_path(path: str | Path) -> Path:
    path = Path(path).resolve()
    # This tool must not write into the concurrent lab workspace, even by mistake.
    lab = (ROOT.parent / "lab").resolve()
    if path == lab or lab in path.parents:
        raise ValueError("Writing inside /lab is prohibited")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: str | Path, value: Any) -> None:
    output_path(path).write_text(json_text(value) + "\n", encoding="utf-8")


def protect_inputs(outputs: list, inputs: list) -> None:
    resolved_outputs = [Path(p).resolve() for p in outputs if p]
    protected = {Path(p).resolve() for p in inputs if p}
    if len(set(resolved_outputs)) != len(resolved_outputs) or protected.intersection(resolved_outputs):
        raise ValueError("Output paths must be distinct from each other and from input files")


def read_jsonl(path: str | Path) -> list[dict]:
    rows = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), 1):
        if line.strip():
            try:
                row = json.loads(line, parse_float=Decimal)
                if not isinstance(row, dict):
                    raise ValueError("expected an object")
                rows.append(row)
            except ValueError as exc:
                raise ValueError(f"{path}:{number}: invalid JSONL: {exc}") from exc
    return rows


def http_json(url: str, body: dict | None = None, key: str | None = None,
              timeout: float = 60) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "Delphi-Agent-Costs/1"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, ensure_ascii=False, default=float, allow_nan=False).encode("utf-8")
    try:
        with urlopen(Request(url, data=data, headers=headers), timeout=timeout) as response:
            result = json.loads(response.read(), parse_float=Decimal)
    except HTTPError as exc:
        # Do not echo server bodies: these can contain user prompts or secrets.
        raise RuntimeError(f"HTTP {exc.code}; no automatic retry") from None
    except (URLError, TimeoutError) as exc:
        raise RuntimeError(f"Network error ({type(exc).__name__}); billing may be unknown") from None
    if not isinstance(result, dict) or result.get("error"):
        raise RuntimeError("API returned an error or invalid object; inspect provider activity")
    return result


def refresh_prices(models: list[str]) -> dict:
    catalog = http_json(MODELS_URL)
    available = {row["id"]: row for row in catalog["data"]}
    unknown = set(models) - available.keys()
    if unknown:
        raise ValueError(f"Unknown OpenRouter model(s): {', '.join(sorted(unknown))}")
    rates = {}
    fetched_at = now()
    for model in models:
        row = available[model]
        pricing = row["pricing"]
        # OpenRouter prices are USD per token, NOT per million tokens.
        rate = {
            "input": str(decimal(pricing["prompt"])),
            "output": str(decimal(pricing["completion"])),
            "cache_read": None if pricing.get("input_cache_read") is None else str(decimal(pricing["input_cache_read"])),
            "cache_write": None if pricing.get("input_cache_write") is None else str(decimal(pricing["input_cache_write"])),
            "request": str(decimal(pricing.get("request", "0"))),
            "source": MODELS_URL,
            "fetched_at": fetched_at,
            "context_length": row.get("context_length"),
            "raw_pricing": pricing,
            "scope": "text tokens and per-request fee; catalog estimate, routing/tier may differ",
        }
        rates[f"openrouter:{model}"] = rate
    return {"schema_version": 1, "currency": "USD", "rates": rates}


def load_prices(path: str | Path | None) -> dict:
    if path is None:
        return {"schema_version": 1, "currency": "USD", "rates": {}}
    data = read_json(path)
    if data.get("schema_version") != 1 or data.get("currency") != "USD":
        raise ValueError("Prices must have schema_version=1 and currency=USD")
    for rate in data["rates"].values():
        for field in ("input", "output", "request", "cache_read", "cache_write"):
            if rate.get(field) is not None:
                decimal(rate[field], field)
        if not rate.get("source") or not rate.get("fetched_at"):
            raise ValueError("Each rate needs source and fetched_at")
    return data


def normalize_usage(response: dict) -> dict | None:
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return None
    is_responses = "input_tokens" in usage
    inp = "input_tokens" if is_responses else "prompt_tokens"
    out = "output_tokens" if is_responses else "completion_tokens"
    if inp not in usage or out not in usage:
        return None
    input_details = usage.get(f"{inp}_details") or {}
    output_details = usage.get(f"{out}_details") or {}
    if not isinstance(input_details, dict) or not isinstance(output_details, dict):
        raise ValueError("Token details must be objects")
    normalized = {
        "input_tokens": count(usage[inp], inp),
        "output_tokens": count(usage[out], out),
        "cached_tokens": count(0 if input_details.get("cached_tokens") is None else input_details["cached_tokens"], "cached_tokens"),
        "cache_write_tokens": count(0 if input_details.get("cache_write_tokens") is None else input_details["cache_write_tokens"], "cache_write_tokens"),
        "reasoning_tokens": count(0 if output_details.get("reasoning_tokens") is None else output_details["reasoning_tokens"], "reasoning_tokens"),
    }
    validate_usage(normalized)
    return normalized


def validate_usage(usage: dict) -> None:
    for key in TOKEN_FIELDS:
        count(usage[key], key)
    if usage["cached_tokens"] + usage["cache_write_tokens"] > usage["input_tokens"]:
        raise ValueError("Cache reads + writes exceed input tokens; cannot price safely")
    if usage["reasoning_tokens"] > usage["output_tokens"]:
        raise ValueError("Reasoning tokens exceed output tokens")


def price_usage(usage: dict | None, rate: dict | None) -> tuple[dict | None, list[str]]:
    if usage is None:
        return None, ["Missing usage; cost is unknown, not zero"]
    if rate is None:
        return None, ["No exact rate for provider/model; cost is unknown"]
    if rate.get("raw_pricing", {}).get("overrides"):
        return None, ["Conditional pricing overrides require an explicit applicable rate; cost is unknown"]
    if decimal(rate.get("raw_pricing", {}).get("internal_reasoning", 0) or 0):
        return None, ["Separate reasoning tariff requires provider-reported cost or a custom rate"]
    validate_usage(usage)
    warnings = ["Rate calculation is an estimate; excludes unrecorded paid tools and routing/tier adjustments"]
    parts = {}
    for field, tokens in (
        ("input", usage["input_tokens"] - usage["cached_tokens"] - usage["cache_write_tokens"]),
        ("cache_read", usage["cached_tokens"]),
        ("cache_write", usage["cache_write_tokens"]),
        ("output", usage["output_tokens"]),
    ):
        if tokens and rate.get(field) is None:
            return None, [f"Missing {field} rate for {tokens} tokens; cost is unknown"]
        parts[field + "_usd"] = dollars(decimal(rate.get(field) or 0) * tokens)
    parts["request_usd"] = dollars(decimal(rate.get("request", 0)))
    parts["total_usd"] = dollars(sum((decimal(v) for v in parts.values()), ZERO))
    # reasoning_tokens are a subset of output_tokens and must never be added again.
    return parts, warnings


def make_event(*, run_id: str, action: str, provider: str, model: str,
               response: dict | None = None, elapsed_ms: Any = None,
               prices: dict | None = None, attempt: int = 1, status: str | None = None,
               error_type: str | None = None, synthetic: bool = False,
               round_index: int | None = None, call_index: int | None = None) -> dict:
    if not all(isinstance(v, str) and v for v in (run_id, action, provider, model)):
        raise ValueError("run_id, action, provider and model must be nonempty strings")
    count(attempt, "attempt", 1)
    if round_index is not None:
        count(round_index, "round_index")
    if call_index is not None:
        count(call_index, "call_index", 1)
    if provider not in {"openrouter", "openai", "local"}:
        raise ValueError("provider must be openrouter, openai or local")
    response = response or {}
    resolved_model = response.get("model") or model
    warnings = []
    try:
        usage = normalize_usage(response)
    except (ValueError, TypeError) as exc:
        usage = None
        warnings.append(f"Invalid usage: {exc}")
    rate = (prices or {}).get("rates", {}).get(f"{provider}:{resolved_model}")
    tier = response.get("service_tier")
    if provider == "openai" and rate and tier != rate.get("service_tier"):
        warnings.append("Response service_tier does not match configured rate")
        rate = None
    breakdown, cost_warnings = price_usage(usage, rate)
    warnings.extend(cost_warnings)
    cost = None if breakdown is None else breakdown["total_usd"]
    basis = "unknown" if cost is None else "rate_estimate"
    reported = (response.get("usage") or {}).get("cost")
    if provider == "openrouter" and reported is not None:
        try:
            cost = dollars(decimal(reported, "usage.cost"))
            basis = "provider_reported"
            warnings = [w for w in warnings if not w.startswith(("No exact rate", "Missing cache", "Rate calculation"))]
            if usage is None:
                warnings = [w for w in warnings if not w.startswith("Missing usage")]
                warnings.append("Missing/invalid token usage; provider cost is still recorded")
        except ValueError:
            cost, basis = None, "unknown"
            warnings.append("Invalid usage.cost; reconcile with provider activity")
    if provider == "local":
        usage = {key: 0 for key in TOKEN_FIELDS}
        cost, basis, breakdown, warnings = "0", "local_no_api_charge", None, []
    if status is None:
        status = "error" if response.get("error") or error_type else response.get("status", "ok")
        if status == "completed":
            status = "ok"
        if any(c.get("finish_reason") == "length" for c in response.get("choices", [])):
            status = "incomplete"
    return {
        "schema_version": 1, "event_id": str(uuid4()), "recorded_at": now(),
        "run_id": run_id, "action": action, "provider": provider,
        "requested_model": model, "model": resolved_model,
        "provider_route": response.get("provider"), "service_tier": tier,
        "response_id": response.get("id"), "attempt": attempt, "status": status,
        "round_index": round_index, "call_index": call_index,
        "error_type": error_type, "synthetic": bool(synthetic), "usage": usage,
        # Preserve the full provider usage separately from the normalized counters.
        # Never persist the response's input, output, instructions or error body.
        "raw_usage": response.get("usage"),
        "elapsed_ms": None if elapsed_ms is None else float(decimal(elapsed_ms, "elapsed_ms")),
        "cost_usd": cost, "cost_basis": basis, "rate_breakdown": breakdown,
        "rate_snapshot": rate, "warnings": warnings,
    }


class Tracker:
    """One process, shared tracker, thread-safe append; one event per API attempt."""

    def __init__(self, path: str | Path, run_id: str, prices: dict | None = None):
        self.path = output_path(path)
        self.run_id = run_id
        self.prices = prices or {}
        self._lock = threading.Lock()

    def record(self, action: str, provider: str, model: str, response: Any = None,
               elapsed_ms: Any = None, **metadata: Any) -> dict:
        if hasattr(response, "model_dump"):
            response = response.model_dump(mode="json")
        event = make_event(run_id=self.run_id, action=action, provider=provider,
                           model=model, response=response, elapsed_ms=elapsed_ms,
                           prices=self.prices, **metadata)
        with self._lock, self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False, default=str, allow_nan=False) + "\n")
        return event

    def measure(self, action: str, provider: str, model: str,
                invoke: Callable[[], Any], *, attempt: int = 1) -> Any:
        started = time.perf_counter()
        try:
            response = invoke()
        except Exception as exc:
            self.record(action, provider, model, elapsed_ms=(time.perf_counter() - started) * 1000,
                        attempt=attempt, status="error", error_type=type(exc).__name__)
            raise
        self.record(action, provider, model, response,
                    elapsed_ms=(time.perf_counter() - started) * 1000, attempt=attempt)
        return response

    async def measure_async(self, action: str, provider: str, model: str,
                            invoke: Callable, *, attempt: int = 1) -> Any:
        started = time.perf_counter()
        try:
            response = await invoke()
        except BaseException as exc:
            self.record(action, provider, model, elapsed_ms=(time.perf_counter() - started) * 1000,
                        attempt=attempt, status="error", error_type=type(exc).__name__)
            raise
        self.record(action, provider, model, response,
                    elapsed_ms=(time.perf_counter() - started) * 1000, attempt=attempt)
        return response


def estimate_prompt(request: dict, encoding: str) -> int:
    if not isinstance(request, dict):
        raise ValueError("Supply a request object or request_file")
    if request.get("previous_response_id") or request.get("conversation"):
        raise ValueError("Supply full conversation context; server-side history cannot be counted locally")

    def reject_media(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("type") in {"image_url", "input_image", "input_audio", "input_file", "file", "video_url"}:
                raise ValueError("Text-only prompt estimates do not support image/audio/file/video inputs")
            for child in value.values():
                reject_media(child)
        elif isinstance(value, list):
            for child in value:
                reject_media(child)

    reject_media(request)
    try:
        import tiktoken
    except ImportError:
        raise ValueError("Text estimates need tiktoken: pip install -r agent_costs/requirements.txt") from None
    # Encode the entire request context including tools, schema and history.
    context = {key: request[key] for key in
               ("messages", "input", "instructions", "tools", "tool_choice", "response_format", "text")
               if key in request}
    if not any(key in context for key in ("messages", "input")):
        raise ValueError("Request must contain messages or input")
    serialized = json.dumps(context, ensure_ascii=False, sort_keys=True, default=str)
    return len(tiktoken.get_encoding(encoding).encode(serialized, disallowed_special=()))


def estimate_scenario(scenario: dict, prices: dict, base: Path) -> dict:
    rows = []
    for action in scenario["actions"]:
        config = {**scenario.get("defaults", {}), **action}
        provider, model = config["provider"], config["model"]
        repeats = count(config.get("calls", 1), "calls", 1)
        method = "provided_token_counts"
        if provider == "local":
            usage = {key: 0 for key in TOKEN_FIELDS}
            breakdown, warnings = {"total_usd": "0"}, []
        else:
            if "input_tokens" in config:
                input_tokens = count(config["input_tokens"], "input_tokens")
            else:
                request = config.get("request")
                if "request_file" in config:
                    request = read_json(base / config["request_file"])
                encoding = config["encoding"]
                input_tokens = estimate_prompt(request, encoding)
                method = f"serialized_context_proxy:{encoding}"
            usage = {"input_tokens": input_tokens,
                     "output_tokens": count(config["output_tokens"], "output_tokens"),
                     "cached_tokens": count(config.get("cached_tokens", 0), "cached_tokens"),
                     "cache_write_tokens": count(config.get("cache_write_tokens", 0), "cache_write_tokens"),
                     "reasoning_tokens": 0}
            validate_usage(usage)
            rate = prices["rates"].get(f"{provider}:{model}")
            breakdown, warnings = price_usage(usage, rate)
            if rate and rate.get("context_length") and input_tokens + usage["output_tokens"] > rate["context_length"]:
                warnings.append("Requested input + output exceeds catalog context length")
            if method.startswith("serialized_context"):
                warnings.append("Approximate text-only tokenizer proxy, not server token count or a spend limit")
        rows.append({"action": config["action"], "provider": provider, "model": model,
                     "calls": repeats, "tokens_per_call": usage, "token_count_method": method,
                     "per_call": breakdown,
                     "estimated_total_usd": None if breakdown is None else dollars(decimal(breakdown["total_usd"]) * repeats),
                     "warnings": warnings})
    unknown = sum(row["estimated_total_usd"] is None for row in rows)
    return {"schema_version": 1, "kind": "estimate", "currency": "USD", "created_at": now(),
            "synthetic": bool(scenario.get("synthetic", False)), "actions": rows,
            "known_subtotal_usd": dollars(sum((decimal(row["estimated_total_usd"]) for row in rows if row["estimated_total_usd"] is not None), ZERO)),
            "complete": unknown == 0, "unpriced_actions": unknown,
            "prices": prices,
            "assumptions": ["output_tokens includes reasoning; calls includes all rounds/retries",
                            "No exchange rates, credit purchase fees, tax, infrastructure or unlisted tool charges"]}


def summarize(events: list[dict], run_id: str | None = None) -> dict:
    groups = {}
    seen_events, seen_responses = set(), set()
    duplicates = 0
    filtered = []
    for event in events:
        if run_id and event["run_id"] != run_id:
            continue
        response_key = (event["provider"], event.get("response_id"))
        if event["event_id"] in seen_events or (response_key[1] and response_key in seen_responses):
            duplicates += 1
            continue
        seen_events.add(event["event_id"])
        if response_key[1]:
            seen_responses.add(response_key)
        filtered.append(event)
        key = (event["run_id"], event["action"], event["provider"], event["model"], event.get("synthetic", False))
        groups.setdefault(key, []).append(event)

    def stats(rows: list[dict]) -> dict:
        durations = sorted(float(decimal(e["elapsed_ms"])) for e in rows if e.get("elapsed_ms") is not None)
        known = [e for e in rows if e.get("cost_usd") is not None]
        unknown = len(rows) - len(known)
        measured = [e for e in rows if e.get("usage") is not None]
        return {
            "calls": len(rows), "ok": sum(e["status"] == "ok" for e in rows),
            "not_ok": sum(e["status"] != "ok" for e in rows),
            "retry_attempts": sum(e["attempt"] > 1 for e in rows),
            "known_subtotal_usd": dollars(sum((decimal(e["cost_usd"]) for e in known), ZERO)),
            "provider_reported_usd": dollars(sum((decimal(e["cost_usd"]) for e in known if e["cost_basis"] == "provider_reported"), ZERO)),
            "rate_estimated_usd": dollars(sum((decimal(e["cost_usd"]) for e in known if e["cost_basis"] == "rate_estimate"), ZERO)),
            "unpriced_calls": unknown, "cost_complete": unknown == 0,
            "missing_usage_calls": len(rows) - len(measured),
            **{key: sum(e["usage"][key] for e in measured) for key in TOKEN_FIELDS},
            "timed_calls": len(durations),
            "sum_request_ms": round(sum(durations), 3),
            "mean_request_ms": round(statistics.mean(durations), 3) if durations else None,
            "p50_request_ms": round(statistics.median(durations), 3) if durations else None,
            "p95_request_ms": round(durations[math.ceil(len(durations) * .95) - 1], 3) if durations else None,
        }

    return {"schema_version": 1, "currency": "USD", "groups": [
        {**dict(zip(("run_id", "action", "provider", "model", "synthetic"), key)), **stats(rows)}
        for key, rows in sorted(groups.items())], "total": stats(filtered),
        "duplicate_events_skipped": duplicates,
        "contains_synthetic": any(e.get("synthetic") for e in filtered),
        "notes": ["sum_request_ms is summed request time, not parallel run wall time",
                  "Cost and latency do not measure semantic quality",
                  "Unknown costs are excluded from subtotal, never treated as free"]}


def print_table(rows: list[dict], columns: tuple[str, ...]) -> None:
    data = [[str(row.get(key) if row.get(key) is not None else "UNKNOWN") for key in columns] for row in rows]
    widths = [max(len(key), *(len(row[i]) for row in data)) for i, key in enumerate(columns)] if data else [len(k) for k in columns]
    print(" | ".join(key.ljust(widths[i]) for i, key in enumerate(columns)))
    for row in data:
        print(" | ".join(value.ljust(widths[i]) for i, value in enumerate(row)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Agent action cost/latency accounting (USD)")
    sub = parser.add_subparsers(dest="command", required=True)
    refresh = sub.add_parser("refresh-prices", help="Fetch public OpenRouter rates; no inference")
    refresh.add_argument("--models", nargs="+", required=True)
    refresh.add_argument("--output", required=True)
    estimate = sub.add_parser("estimate", help="Offline estimate from scenario token counts or prompts")
    estimate.add_argument("scenario", type=Path)
    estimate.add_argument("--prices", required=True)
    estimate.add_argument("--output")
    record = sub.add_parser("record", help="Normalize saved responses wrapped with action metadata")
    record.add_argument("input", type=Path)
    record.add_argument("--prices")
    record.add_argument("--output", required=True)
    report = sub.add_parser("report", help="Summarize saved events; never reprice historical usage")
    report.add_argument("events", type=Path)
    report.add_argument("--run-id")
    report.add_argument("--json", dest="json_path")
    report.add_argument("--csv", dest="csv_path")
    run = sub.add_parser("run", help="Make ONE paid OpenRouter chat request, record usage and latency")
    run.add_argument("--request", required=True, type=Path)
    run.add_argument("--model", required=True)
    run.add_argument("--action", required=True)
    run.add_argument("--run-id", required=True)
    run.add_argument("--prices")
    run.add_argument("--log", required=True)
    run.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args(argv)
    try:
        if args.command == "refresh-prices":
            prices = refresh_prices(args.models)
            write_json(args.output, prices)
            print(f"Saved {len(prices['rates'])} OpenRouter rate(s) to {args.output}")
        elif args.command == "estimate":
            protect_inputs([args.output], [args.scenario, args.prices])
            result = estimate_scenario(read_json(args.scenario), load_prices(args.prices), args.scenario.parent)
            if args.output:
                write_json(args.output, result)
            print_table(result["actions"], ("action", "model", "calls", "estimated_total_usd"))
            print(f"Estimated known subtotal USD: {result['known_subtotal_usd']}; complete={result['complete']}")
            for warning in sorted({w for row in result['actions'] for w in row['warnings']}):
                print(f"Note: {warning}")
            return 0 if result["complete"] else 2
        elif args.command == "record":
            prices = load_prices(args.prices)
            # Validate all rows before writing; imports are not partially applied.
            rows = [make_event(prices=prices, **row) for row in read_jsonl(args.input)]
            path = output_path(args.output)
            if path == args.input.resolve():
                raise ValueError("Input and output must differ")
            with path.open("x", encoding="utf-8") as stream:
                for row in rows:
                    stream.write(json.dumps(row, ensure_ascii=False, default=str, allow_nan=False) + "\n")
            print(f"Saved {len(rows)} events to {path}")
        elif args.command == "report":
            protect_inputs([args.json_path, args.csv_path], [args.events])
            result = summarize(read_jsonl(args.events), args.run_id)
            if args.json_path:
                write_json(args.json_path, result)
            if args.csv_path:
                with output_path(args.csv_path).open("w", encoding="utf-8-sig", newline="") as stream:
                    if result["groups"]:
                        writer = csv.DictWriter(stream, fieldnames=list(result["groups"][0]))
                        writer.writeheader()
                        writer.writerows(result["groups"])
            print_table(result["groups"], ("run_id", "action", "model", "calls", "known_subtotal_usd", "unpriced_calls", "p95_request_ms"))
            print(json_text(result["total"]))
            if result["contains_synthetic"]:
                print("SYNTHETIC DATA: not measured project performance")
        elif args.command == "run":
            protect_inputs([args.log], [args.request, args.prices])
            key = os.environ.get("OPENROUTER_API_KEY")
            if not key:
                raise ValueError("Set OPENROUTER_API_KEY in the environment")
            if not math.isfinite(args.timeout) or args.timeout <= 0:
                raise ValueError("timeout must be positive and finite")
            request = read_json(args.request)
            if request.get("stream") or "messages" not in request:
                raise ValueError("run accepts non-streaming Chat Completions requests with messages")
            count(request.get("max_tokens"), "max_tokens", 1)
            if "models" in request or "route" in request:
                raise ValueError("Use one explicit model per benchmark request")
            request["model"], request["stream"] = args.model, False
            tracker = Tracker(args.log, args.run_id, load_prices(args.prices))
            response = tracker.measure(args.action, "openrouter", args.model,
                                       lambda: http_json(CHAT_URL, request, key, args.timeout))
            print(json_text({"response_id": response.get("id"), "model": response.get("model"),
                             "usage": response.get("usage"), "log": args.log}))
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
