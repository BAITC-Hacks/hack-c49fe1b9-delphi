"""The lab observer never needs a real key or a paid request for these checks."""
from contextlib import redirect_stderr
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
from decimal import Decimal

from agent_costs.cost_tracker import load_prices, make_event, read_jsonl, summarize
from agent_costs.lab_run import DEFAULT_PRICES, LAB, Observer, response_prices


def response(input_tokens=1000, tier="default", model="gpt-6-sol"):
    return {"id": "synthetic-response", "model": model, "service_tier": tier,
            "status": "completed", "usage": {"input_tokens": input_tokens,
                "input_tokens_details": {"cached_tokens": 400, "cache_write_tokens": 100},
                "output_tokens": 200, "output_tokens_details": {"reasoning_tokens": 150}}}


class LabObserverTests(unittest.TestCase):
    def setUp(self):
        self.prices = load_prices(DEFAULT_PRICES)

    def test_sol_default_cache_and_reasoning_arithmetic(self):
        data = response()
        event = make_event(run_id="r", action="extract", provider="openai", model="gpt-6-sol",
                           response=data, prices=response_prices(self.prices, data))
        # 500*2 + 400*.2 + 100*2.5 + 200*10, divided by a million.
        self.assertEqual(Decimal(event["cost_usd"]), Decimal("0.00333"))

    def test_sol_long_context_threshold_and_tiers(self):
        for tokens, tier, inp, out in ((272000, "default", ".000002", ".00001"),
                                       (272001, "default", ".000004", ".000015"),
                                       (272001, "flex", ".000002", ".0000075"),
                                       (1000, "fast", ".000004", ".00002")):
            with self.subTest(tokens=tokens, tier=tier):
                rate = response_prices(self.prices, response(tokens, tier))["rates"]["openai:gpt-6-sol"]
                self.assertEqual(Decimal(rate["input"]), Decimal(inp))
                self.assertEqual(Decimal(rate["output"]), Decimal(out))
        self.assertEqual(self.prices["rates"]["openai:gpt-6-sol"]["input"], "0.000002")

    def test_unknown_tier_model_or_usage_remains_unknown(self):
        for data in (response(tier=None), response(tier="scale"), response(model="unpriced"), {}):
            self.assertEqual(response_prices(self.prices, data)["rates"], {})

    def test_observer_collects_same_calls_retries_tools_and_restores_methods(self):
        class FakeResponses:
            calls = 0
            def create(self, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise TimeoutError("private error body")
                return response()

        class FakeRunner:
            def request(self, stage):
                resource = FakeResponses()
                try:
                    resource.create(model="gpt-6-sol")
                except TimeoutError:
                    pass
                value = resource.create(model="gpt-6-sol")
                self.execute_tool("get_clause", {"source_id": "private-content"})
                return value
            def execute_tool(self, name, arguments):
                return "private source text"

        def execute(store, run_id, settings):
            return FakeRunner().request("extract")

        cli = SimpleNamespace(execute_run=execute)
        original_create, original_request = FakeResponses.create, FakeRunner.request
        with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()):
            observer = Observer(Path(directory), self.prices)
            with observer.installed(cli, FakeRunner, FakeResponses):
                result = cli.execute_run(None, "run-synthetic", None)
            self.assertEqual(result, response())
            events = read_jsonl(Path(directory) / "run-synthetic/events.jsonl")
            self.assertEqual([e["attempt"] for e in events], [1, 2, 1])
            self.assertEqual([e["action"] for e in events], ["extract", "extract", "get_clause"])
            self.assertEqual(summarize(events)["total"]["unpriced_calls"], 1)
            self.assertTrue((Path(directory) / "run-synthetic/report.csv").exists())
            self.assertNotIn("private", str(events))
        self.assertIs(FakeResponses.create, original_create)
        self.assertIs(FakeRunner.request, original_request)
        self.assertIs(cli.execute_run, execute)

    def test_logging_failure_does_not_become_an_api_retry(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()):
            observer = Observer(Path(directory), self.prices)
            token = observer.run.set("run-synthetic")
            with patch("agent_costs.lab_run.Tracker.record", side_effect=OSError("disk full")):
                observer.record("extract", "gpt-6-sol", response(), 100)
            observer.run.reset(token)
            self.assertEqual(observer.failures, 1)

    @unittest.skipUnless(importlib.util.find_spec("openai"), "requires lab Python environment")
    def test_real_lab_request_with_fake_sdk_response(self):
        import sys
        sys.dont_write_bytecode = True
        if str(LAB) not in sys.path:
            sys.path.insert(0, str(LAB))
        from delphi_lab.agent import _Runner, _Translation
        from openai.resources.responses import Responses

        class FakeResponse:
            id = "synthetic-response"
            status = "completed"
            output = []
            output_text = '{"findings": []}'
            usage = SimpleNamespace(input_tokens=1000, output_tokens=200, total_tokens=1200)
            def model_dump(self, mode):
                return response()

        def execute(store, run_id, settings):
            runner = _Runner([], "gpt-6-sol", "ru", 2, 500, 16000, 0, 20, None)
            try:
                return runner.request("translation", {"findings": []}, _Translation)
            finally:
                if runner.client:
                    runner.client.close()

        cli = SimpleNamespace(execute_run=execute)
        with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()), \
                patch.dict("os.environ", {"OPENAI_API_KEY": "fake-test-key", "OPENAI_BASE_URL": "https://api.openai.com/v1"}), \
                patch.object(Responses, "create", return_value=FakeResponse()) as api:
            observer = Observer(Path(directory), self.prices)
            with observer.installed(cli, _Runner, Responses):
                result = cli.execute_run(None, "run-synthetic", None)
            self.assertEqual(result.findings, [])
            api.assert_called_once()
            event = read_jsonl(Path(directory) / "run-synthetic/events.jsonl")[0]
            self.assertEqual(event["action"], "translation")
            self.assertEqual(Decimal(event["cost_usd"]), Decimal(".00333"))


if __name__ == "__main__":
    unittest.main()
