"""Launch the existing lab CLI with in-memory usage observers, without editing lab.

Use lab's Python environment. This launcher itself makes no API requests.
The user-selected lab command performs its normal work and writes its own data.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from contextvars import ContextVar
import copy
import csv
from functools import wraps
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlparse

from .cost_tracker import (
    ROOT, Tracker, decimal, load_prices, normalize_usage, output_path,
    read_jsonl, summarize, write_json,
)

LAB = ROOT.parent / "lab"
DEFAULT_PRICES = ROOT / "examples/prices.openai-gpt6-sol.json"


def response_prices(prices: dict, response: dict) -> dict:
    """Select the documented tier and context band; never guess model aliases."""
    key = "openai:" + response.get("model", "")
    rate = copy.deepcopy(prices.get("rates", {}).get(key))
    empty = {"schema_version": 1, "currency": "USD", "rates": {}}
    if not rate:
        return empty
    tier = response.get("service_tier")
    multipliers = rate.get("tier_multipliers", {})
    if not multipliers:
        return prices  # Custom flat rate: core checks exact model/tier itself.
    if tier not in multipliers:
        return empty
    try:
        usage = normalize_usage(response)
    except (ValueError, TypeError):
        return empty
    if usage is None:
        return empty
    long_context = usage["input_tokens"] > rate["long_context_threshold"]
    for name in ("input", "cache_read", "cache_write", "output"):
        multiplier = decimal(multipliers[tier])
        if long_context:
            field = "long_context_output_multiplier" if name == "output" else "long_context_input_multiplier"
            multiplier *= decimal(rate[field])
        rate[name] = str(decimal(rate[name]) * multiplier)
    rate.update(service_tier=tier, long_context_applied=long_context)
    return {"schema_version": 1, "currency": "USD", "rates": {key: rate}}


class Observer:
    def __init__(self, directory: Path, prices: dict):
        self.directory, self.prices = directory, prices
        self.run = ContextVar("cost_run", default=None)
        self.request = ContextVar("cost_request", default=None)
        self.failures = 0
        self.run_ids: set[str] = set()

    def record(self, action, model, response, elapsed_ms, *, attempt=1, error=None, local=False):
        run_id = self.run.get()
        if run_id is None:
            return
        try:
            self.run_ids.add(run_id)
            payload = response.model_dump(mode="json") if hasattr(response, "model_dump") else (response or {})
            prices = response_prices(self.prices, payload) if not local else {}
            tracker = Tracker(self.directory / run_id / "events.jsonl", run_id, prices)
            event = tracker.record(action, "local" if local else "openai", model, payload,
                                   elapsed_ms=elapsed_ms, attempt=attempt,
                                   error_type=type(error).__name__ if error else None,
                                   status="error" if error else None)
            if not local:
                charge = event["cost_usd"] if event["cost_usd"] is not None else "UNKNOWN"
                print(f"[agent_costs] {action} attempt={attempt} USD={charge} "
                      f"basis={event['cost_basis']} ms={elapsed_ms:.0f}", file=sys.stderr)
            self.save_report(run_id)
        except Exception as exc:
            # Observability must not cause the agent to repeat a paid request.
            self.failures += 1
            print(f"[agent_costs] Recording failed: {type(exc).__name__}; pipeline continues", file=sys.stderr)

    def save_report(self, run_id):
        folder = self.directory / run_id
        result = summarize(read_jsonl(folder / "events.jsonl"))
        result["observer_errors"] = self.failures
        write_json(folder / "report.json", result)
        with output_path(folder / "report.csv").open("w", encoding="utf-8-sig", newline="") as stream:
            if result["groups"]:
                writer = csv.DictWriter(stream, fieldnames=list(result["groups"][0]))
                writer.writeheader()
                writer.writerows(result["groups"])

    @contextmanager
    def installed(self, cli, runner_class, responses_class):
        original_execute = cli.execute_run
        original_request = runner_class.request
        original_create = responses_class.create
        original_tool = runner_class.execute_tool

        @wraps(original_execute)
        def execute(store, run_id, settings):
            token = self.run.set(run_id)
            try:
                return original_execute(store, run_id, settings)
            finally:
                self.run.reset(token)

        @wraps(original_request)
        def request(runner, stage, *args, **kwargs):
            token = self.request.set({"action": stage, "attempt": 1})
            try:
                return original_request(runner, stage, *args, **kwargs)
            finally:
                self.request.reset(token)

        @wraps(original_create)
        def create(resource, *args, **kwargs):
            context = self.request.get()
            if context is None or self.run.get() is None:
                return original_create(resource, *args, **kwargs)
            started = time.perf_counter()
            attempt = context["attempt"]
            try:
                response = original_create(resource, *args, **kwargs)
            except BaseException as exc:
                self.record(context["action"], kwargs["model"], None,
                            (time.perf_counter() - started) * 1000, attempt=attempt, error=exc)
                context["attempt"] += 1
                raise
            self.record(context["action"], kwargs["model"], response,
                        (time.perf_counter() - started) * 1000, attempt=attempt)
            context["attempt"] = 1  # Next successful tool round starts a new attempt sequence.
            return response

        @wraps(original_tool)
        def tool(runner, name, *args, **kwargs):
            started = time.perf_counter()
            error = None
            try:
                return original_tool(runner, name, *args, **kwargs)
            except BaseException as exc:
                error = exc
                raise
            finally:
                self.record(name, "local", None, (time.perf_counter() - started) * 1000,
                            error=error, local=True)

        cli.execute_run, runner_class.request = execute, request
        responses_class.create, runner_class.execute_tool = create, tool
        try:
            yield
        finally:
            cli.execute_run, runner_class.request = original_execute, original_request
            responses_class.create, runner_class.execute_tool = original_create, original_tool


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run lab demo/analyze with cost accounting; no source edits")
    parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES)
    parser.add_argument("--out", type=Path, default=ROOT / "out/lab")
    parser.add_argument("lab_args", nargs=argparse.REMAINDER, help="-- demo/analyze [lab options]")
    args = parser.parse_args(argv)
    lab_args = args.lab_args[1:] if args.lab_args[:1] == ["--"] else args.lab_args
    if not lab_args or lab_args[0] not in {"demo", "analyze"}:
        parser.error("Pass -- demo ... or -- analyze ...; serve/translate are not supported by this launcher")
    # Avoid even incidental bytecode writes into lab when importing its code.
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(LAB))
    try:
        from delphi_lab import __main__ as cli
        from delphi_lab.agent import _Runner
        from openai.resources.responses import Responses
        if getattr(_Runner, 'native_cost_tracking', False):
            print('agent_costs: lab has native accounting. Use lab/run.ps1 directly; '
                  'this launcher is disabled to prevent double accounting.', file=sys.stderr)
            return 2
        # Lab config has now loaded lab/.env without displaying the key.
        endpoint = urlparse(os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1")
        if endpoint.scheme != "https" or endpoint.hostname != "api.openai.com" or endpoint.path.rstrip("/") != "/v1":
            raise ValueError("This launcher prices direct non-regional OpenAI only; unexpected OPENAI_BASE_URL")
        prices = load_prices(args.prices)
        # Reserve/check output before any model request can be sent.
        output_path(args.out / ".path-check")
        observer = Observer(args.out.resolve(), prices)
    except ImportError:
        print("Use lab/.venv/Scripts/python -B -m agent_costs.lab_run -- demo ...", file=sys.stderr)
        return 1
    except (ValueError, OSError) as exc:
        print(f"agent_costs: {exc}", file=sys.stderr)
        return 1
    previous_argv = sys.argv
    sys.argv = ["delphi_lab", *lab_args]
    print(f"[agent_costs] Output: {observer.directory}/<run_id>/", file=sys.stderr)
    try:
        with observer.installed(cli, _Runner, Responses):
            code = cli.main()
        return code if code else (2 if observer.failures else 0)
    finally:
        sys.argv = previous_argv
        for run_id in sorted(observer.run_ids):
            print(f"[agent_costs] Report: {observer.directory / run_id / 'report.json'}", file=sys.stderr)
        if observer.failures:
            print(f"[agent_costs] INCOMPLETE: {observer.failures} recording error(s)", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
