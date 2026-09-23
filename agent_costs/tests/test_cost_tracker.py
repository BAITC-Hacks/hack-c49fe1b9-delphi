"""Synthetic accounting acceptance cases; no paid API calls."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import copy
from decimal import Decimal
import importlib.util
import io
from contextlib import redirect_stdout, redirect_stderr
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from agent_costs.cost_tracker import (
    ROOT, Tracker, decimal, estimate_prompt, estimate_scenario, main,
    make_event, normalize_usage, output_path, price_usage, read_jsonl,
    refresh_prices, summarize,
)


RATE = {"input": "0.000002", "output": "0.000008", "cache_read": "0.0000005",
        "cache_write": "0.0000025", "request": "0.001",
        "source": "synthetic test tariff", "fetched_at": "2026-09-23T00:00:00+00:00"}
PRICES = {"schema_version": 1, "currency": "USD",
          "rates": {"openrouter:test": RATE, "openai:test": RATE}}


def response(cost=None, **changes):
    result = {"id": "test-id", "model": "test", "usage": {
        "prompt_tokens": 1000, "completion_tokens": 200,
        "prompt_tokens_details": {"cached_tokens": 400, "cache_write_tokens": 100},
        "completion_tokens_details": {"reasoning_tokens": 150}}}
    if cost is not None:
        result["usage"]["cost"] = cost
    result.update(changes)
    return result


def event(**kwargs):
    defaults = dict(run_id="run-1", action="match_functions", provider="openrouter",
                    model="test", response=response(), prices=PRICES, elapsed_ms=100)
    defaults.update(kwargs)
    return make_event(**defaults)


class AccountingTests(unittest.TestCase):
    def test_cached_read_write_are_disjoint_and_reasoning_not_double_charged(self):
        # 500*2e-6 + 400*.5e-6 + 100*2.5e-6 + 200*8e-6 + .001
        value = event()
        self.assertEqual(Decimal(value["cost_usd"]), Decimal("0.00405"))
        self.assertEqual(value["usage"]["reasoning_tokens"], 150)
        self.assertEqual(value["cost_basis"], "rate_estimate")

    def test_openai_responses_and_chat_usage_are_equivalent(self):
        chat = response()["usage"]
        responses = {"usage": {"input_tokens": chat["prompt_tokens"],
                               "output_tokens": chat["completion_tokens"],
                               "input_tokens_details": chat["prompt_tokens_details"],
                               "output_tokens_details": chat["completion_tokens_details"]}}
        self.assertEqual(normalize_usage(responses), normalize_usage(response()))

    def test_actual_openrouter_cost_overrides_rate_including_zero(self):
        for amount in ("0", "0.99"):
            with self.subTest(amount=amount):
                value = event(response=response(amount))
                self.assertEqual(value["cost_usd"], amount)
                self.assertEqual(value["cost_basis"], "provider_reported")

    def test_upstream_cost_is_not_added_to_reported_cost(self):
        data = response("0.02")
        data["usage"]["cost_details"] = {"upstream_inference_cost": 2}
        self.assertEqual(event(response=data)["cost_usd"], "0.02")

    def test_cost_can_exist_without_token_counts(self):
        value = event(response={"usage": {"cost": "0.01"}})
        self.assertEqual(value["cost_usd"], "0.01")
        self.assertIsNone(value["usage"])

    def test_unknown_cost_is_not_zero(self):
        value = event(response={})
        self.assertIsNone(value["cost_usd"])
        report = summarize([value])
        self.assertFalse(report["total"]["cost_complete"])
        self.assertEqual(report["total"]["unpriced_calls"], 1)

    def test_resolved_model_requires_its_own_rate(self):
        value = event(response=response(model="different-model"))
        self.assertIsNone(value["cost_usd"])
        self.assertEqual(value["requested_model"], "test")
        self.assertEqual(value["model"], "different-model")

    def test_provider_prices_are_not_interchangeable(self):
        value = event(provider="openai", prices={"rates": {"openrouter:test": RATE}})
        self.assertIsNone(value["cost_usd"])

    def test_openai_tier_mismatch_does_not_silently_use_standard_rate(self):
        value = event(provider="openai", response=response(service_tier="flex"))
        self.assertIsNone(value["cost_usd"])
        prices = copy.deepcopy(PRICES)
        prices["rates"]["openai:test"]["service_tier"] = "flex"
        self.assertIsNotNone(event(provider="openai", response=response(service_tier="flex"), prices=prices)["cost_usd"])

    def test_missing_cache_tariff_is_unknown(self):
        rate = dict(RATE, cache_write=None)
        cost, _ = price_usage(normalize_usage(response()), rate)
        self.assertIsNone(cost)

    def test_invalid_usage_preserves_provider_charge(self):
        data = response("0.2")
        data["usage"]["prompt_tokens_details"]["cached_tokens"] = 1100
        value = event(response=data)
        self.assertIsNone(value["usage"])
        self.assertEqual(value["cost_usd"], "0.2")

    def test_bad_numbers_rejected(self):
        for value in (-1, "NaN", "Infinity", True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                decimal(value)
        for value in (-1, 1.5, True):
            data = response()
            data["usage"]["prompt_tokens"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_usage(data)

    def test_bad_provider_cost_is_unknown_even_when_rate_exists(self):
        self.assertIsNone(event(response=response("NaN"))["cost_usd"])

    def test_conditional_and_separate_reasoning_rates_are_not_flat_priced(self):
        for raw in ({"overrides": [{"prompt": "1"}]}, {"internal_reasoning": ".01"}):
            cost, _ = price_usage(normalize_usage(response()), dict(RATE, raw_pricing=raw))
            self.assertIsNone(cost)

    def test_duplicate_imports_are_not_double_counted(self):
        first, duplicate = event(), event()
        report = summarize([first, first, duplicate])
        self.assertEqual(report["total"]["calls"], 1)
        self.assertEqual(report["duplicate_events_skipped"], 2)

    def test_retries_latency_and_run_filter(self):
        failure = event(response={}, status="error", elapsed_ms=1000)
        retry = event(response=response("0.02"), attempt=2, elapsed_ms=3000)
        other = event(run_id="other", response=response("0.5", id="other"))
        report = summarize([failure, retry, other], "run-1")["total"]
        self.assertEqual(report["calls"], 2)
        self.assertEqual(report["retry_attempts"], 1)
        self.assertEqual(report["not_ok"], 1)
        self.assertEqual(report["unpriced_calls"], 1)
        self.assertEqual(report["known_subtotal_usd"], "0.02")
        self.assertEqual(report["p50_request_ms"], 2000)
        self.assertEqual(report["p95_request_ms"], 3000)

    def test_empty_report(self):
        report = summarize([])
        self.assertEqual(report["total"]["calls"], 0)
        self.assertIsNone(report["total"]["p95_request_ms"])

    def test_incomplete_response_keeps_cost(self):
        data = response("0.01", choices=[{"finish_reason": "length"}])
        self.assertEqual(event(response=data)["status"], "incomplete")
        self.assertEqual(event(response=data)["cost_usd"], "0.01")

    def test_local_tool_has_no_model_charge(self):
        value = event(provider="local", model="local", response={})
        self.assertEqual(value["cost_usd"], "0")
        self.assertEqual(value["usage"]["input_tokens"], 0)

    def test_catalog_per_token_units_and_unknown_model(self):
        catalog = {"data": [{"id": "test", "pricing": {"prompt": "0.000002", "completion": "0.000008"}}]}
        with patch("agent_costs.cost_tracker.http_json", return_value=catalog):
            prices = refresh_prices(["test"])
            self.assertEqual(Decimal(prices["rates"]["openrouter:test"]["input"]), Decimal("0.000002"))
            with self.assertRaises(ValueError):
                refresh_prices(["not-a-model"])

    def test_scenario_repetitions_and_unknown_are_visible(self):
        scenario = {"defaults": {"provider": "openrouter", "model": "test"}, "actions": [
            {"action": "extract", "input_tokens": 1000, "output_tokens": 200, "calls": 3},
            {"action": "translate", "input_tokens": 1000, "output_tokens": 200, "model": "unknown"}]}
        result = estimate_scenario(scenario, PRICES, Path("."))
        self.assertEqual(Decimal(result["known_subtotal_usd"]), Decimal("0.0138"))
        self.assertFalse(result["complete"])
        self.assertEqual(result["unpriced_actions"], 1)

    def test_lab_writes_are_blocked_including_traversal(self):
        for path in (ROOT.parent / "lab" / "x.json", ROOT / ".." / "lab" / "x.json"):
            with self.assertRaises(ValueError):
                output_path(path)

    def test_measure_logs_errors_without_prompt_or_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            tracker = Tracker(path, "run", PRICES)
            def fail():
                raise TimeoutError("secret API key or prompt text")
            with self.assertRaises(TimeoutError):
                tracker.measure("extract", "openrouter", "test", fail)
            saved = path.read_text(encoding="utf-8")
            self.assertNotIn("secret", saved)
            self.assertEqual(read_jsonl(path)[0]["status"], "error")
            self.assertIsNone(read_jsonl(path)[0]["cost_usd"])

    def test_shared_tracker_concurrent_appends_and_sdk_object(self):
        class SDKObject:
            def model_dump(self, mode):
                return response("0.01")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            tracker = Tracker(path, "run", PRICES)
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(lambda _: tracker.record("extract", "openrouter", "test", SDKObject()), range(12)))
            self.assertEqual(len(read_jsonl(path)), 12)

    def test_async_measure(self):
        async def invoke():
            return response("0.01")
        with tempfile.TemporaryDirectory() as directory:
            tracker = Tracker(Path(directory) / "events.jsonl", "run", PRICES)
            result = asyncio.run(tracker.measure_async("match", "openrouter", "test", invoke))
            self.assertEqual(result["usage"]["cost"], "0.01")

    def test_media_and_server_side_history_require_actual_counts(self):
        for request in ({"previous_response_id": "old", "input": "new"},
                        {"input": [{"type": "input_image", "image_url": "url"}]}):
            with self.assertRaises(ValueError):
                estimate_prompt(request, "o200k_base")

    @unittest.skipUnless(importlib.util.find_spec("tiktoken"), "optional tiktoken not installed")
    def test_ru_kk_and_tool_schema_are_counted(self):
        base = {"messages": [{"role": "user", "content": "Проверь обязанности. Міндеттерді тексер."}]}
        with_tools = {**base, "tools": [{"type": "function", "function": {"name": "search_clauses", "description": "Search documents", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}}]}
        plain = estimate_prompt(base, "o200k_base")
        self.assertGreater(plain, 0)
        self.assertGreater(estimate_prompt(with_tools, "o200k_base"), plain)

    def test_import_and_report_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            events = Path(directory) / "events.jsonl"
            report = Path(directory) / "report.json"
            csv_path = Path(directory) / "report.csv"
            self.assertEqual(main(["record", str(ROOT / "examples/responses.synthetic.jsonl"), "--output", str(events)]), 0)
            self.assertEqual(main(["report", str(events), "--json", str(report), "--csv", str(csv_path)]), 0)
            result = json.loads(report.read_text(encoding="utf-8"))
            self.assertTrue(result["contains_synthetic"])
            self.assertEqual(result["total"]["unpriced_calls"], 2)
            self.assertEqual(Decimal(result["total"]["known_subtotal_usd"]), Decimal("0.01668"))
            self.assertTrue(csv_path.read_text(encoding="utf-8-sig").startswith("run_id,"))

    def test_run_cli_sends_one_configured_request_and_logs_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "events.jsonl"
            args = ["run", "--request", str(ROOT / "examples/request.synthetic.json"),
                    "--model", "test", "--action", "extract", "--run-id", "run",
                    "--log", str(log)]
            with patch.dict("os.environ", {"OPENROUTER_API_KEY": "test-secret"}), \
                    patch("agent_costs.cost_tracker.http_json", return_value=response("0.01")) as network, \
                    redirect_stdout(io.StringIO()) as output:
                self.assertEqual(main(args), 0)
            network.assert_called_once()
            self.assertEqual(network.call_args.args[1]["model"], "test")
            self.assertFalse(network.call_args.args[1]["stream"])
            self.assertGreater(network.call_args.args[1]["max_tokens"], 0)
            saved = read_jsonl(log)
            self.assertEqual(saved[0]["cost_basis"], "provider_reported")
            self.assertNotIn("test-secret", log.read_text(encoding="utf-8") + output.getvalue())
            self.assertNotIn("messages", saved[0])

    def test_run_cli_failure_logs_once_and_does_not_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "events.jsonl"
            with patch.dict("os.environ", {"OPENROUTER_API_KEY": "test-secret"}), \
                    patch("agent_costs.cost_tracker.http_json", side_effect=RuntimeError("HTTP 429")) as network, \
                    redirect_stderr(io.StringIO()):
                code = main(["run", "--request", str(ROOT / "examples/request.synthetic.json"),
                             "--model", "test", "--action", "extract", "--run-id", "run",
                             "--log", str(log)])
            self.assertEqual(code, 2)
            network.assert_called_once()
            self.assertEqual(len(read_jsonl(log)), 1)
            self.assertIsNone(read_jsonl(log)[0]["cost_usd"])

    def test_report_cannot_overwrite_event_log(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "events.jsonl"
            log.write_text(json.dumps(event()), encoding="utf-8")
            original = log.read_bytes()
            with redirect_stderr(io.StringIO()):
                self.assertEqual(main(["report", str(log), "--json", str(log)]), 2)
            self.assertEqual(log.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
