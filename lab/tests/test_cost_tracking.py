"""Offline integration checks: scripted SDK responses, no network or paid calls.

Run from lab: .venv/Scripts/python -B -m unittest discover -s tests -v
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, redirect_stderr
from copy import deepcopy
from decimal import Decimal
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import httpx
from openai import APIConnectionError, APIStatusError

from delphi_lab import agent, costs, pipeline
from delphi_lab.config import Settings
from delphi_lab.models import AgentResult, Finding


PRIVATE = "PRIVATE_DOCUMENT_PROMPT_OR_KEY_MUST_NOT_BE_LOGGED"


class DumpObject(SimpleNamespace):
    def model_dump(self, **kwargs):
        return deepcopy(vars(self))


def usage(input_tokens=100, output_tokens=20, cached_tokens=0, cache_write_tokens=0):
    return DumpObject(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        input_tokens_details={"cached_tokens": cached_tokens,
                              "cache_write_tokens": cache_write_tokens,
                              "additional_numeric_counter": 7},
        output_tokens_details={"reasoning_tokens": min(5, output_tokens)},
    )


def response(response_id="resp_fake_1", *, tokens=True, output=None,
             text=None, tier="default", model="gpt-6-sol", status="completed"):
    token_usage = usage() if tokens is True else tokens
    value = DumpObject(
        id=response_id, model=model, status=status, service_tier=tier,
        usage=token_usage, output=output or [],
        output_text=text if text is not None else json.dumps(
            {"findings": [], "reviewed_function_ids": []}),
        instructions=PRIVATE, metadata={"private_document": PRIVATE},
    )
    original_dump = value.model_dump

    def dump(**kwargs):
        data = original_dump(**kwargs)
        data.pop("model_dump", None)
        data["usage"] = token_usage.model_dump() if token_usage is not None else None
        data["output"] = [item.model_dump() for item in value.output]
        return data

    value.model_dump = dump
    return value


class ScriptedClient:
    """Only the small interface used by _Runner; unexpected calls fail closed."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.requests = []
        self.responses = self
        self.closed = False

    def with_options(self, **kwargs):
        return self

    def create(self, **kwargs):
        self.requests.append(kwargs)
        if not self.outcomes:
            raise AssertionError("Unexpected additional model request")
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    def close(self):
        self.closed = True


class MemoryStore:
    """No database, no real document fixtures, no writes into lab data/."""

    def __init__(self, run_id="run_memory"):
        self.value = {
            "id": run_id, "analysis_id": "analysis_memory", "state": "queued",
            "stage": "queued", "mode": "live", "model": "gpt-6-sol",
            "output_language": "ru", "review_revision": 0, "coverage": {},
            "limitations": [], "errors": [], "units": [], "functions": [],
            "findings": [], "trace": [], "usage": {}, "diff": {},
        }
        self.cached = {}

    def run(self, run_id):
        if run_id != self.value["id"]:
            raise KeyError(run_id)
        return deepcopy(self.value)

    def save_run(self, run):
        self.value = deepcopy(run)

    def documents(self, run_id):
        return []

    def analysis(self, analysis_id):
        return {"id": analysis_id, "run": None}

    def create_analysis(self, title):
        return {"id": "analysis_memory"}

    def start(self, *args):
        return deepcopy(self.value)

    def translation(self, run_id, revision, locale):
        return deepcopy(self.cached.get((run_id, revision, locale)))

    def save_translation(self, run_id, revision, locale, payload):
        self.cached[(run_id, revision, locale)] = deepcopy(payload)


class CostTrackingTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(costs, "OUTPUT_ROOT", self.directory))
        self.stack.enter_context(patch.dict(os.environ, {
            "LAB_COST_TRACKING": "1", "OPENAI_API_KEY": "synthetic-test-key",
            "OPENAI_BASE_URL": "https://api.openai.com/v1",
        }))
        original_connect = socket.socket.connect

        def local_only(sock, address):
            # Windows asyncio creates its internal socketpair over loopback.
            if not isinstance(address, tuple) or address[0] not in {"127.0.0.1", "::1"}:
                raise AssertionError("External network is forbidden in these tests")
            return original_connect(sock, address)

        self.stack.enter_context(patch.object(socket.socket, "connect", local_only))
        self.factory = self.stack.enter_context(patch("openai.OpenAI"))
        self.stack.enter_context(patch.object(agent.time, "sleep"))
        self.stderr = io.StringIO()
        self.stack.enter_context(redirect_stderr(self.stderr))

    def runner(self, *outcomes, run_id="run_cost_test", max_calls=40):
        value = agent._Runner([], "gpt-6-sol", "ru", max_calls, 5000,
                              16000, 4, 900, None, run_id=run_id)
        value.client = ScriptedClient(*outcomes)
        return value

    def request(self, runner, tools=False):
        return runner.request("risks", {"private": PRIVATE}, agent._Risks, tools=tools)

    def events(self, run_id="run_cost_test"):
        path = self.directory / run_id / "events.jsonl"
        return [json.loads(row) for row in path.read_text(encoding="utf-8").splitlines()]

    def report(self, run_id="run_cost_test"):
        return json.loads((self.directory / run_id / "report.json").read_text(encoding="utf-8"))

    def test_success_records_actual_run_stage_model_duration_and_full_usage(self):
        reply = response()
        runner = self.runner(reply)
        parsed = self.request(runner)
        self.assertEqual(parsed.findings, [])
        self.assertEqual(len(runner.client.requests), 1)
        event, = self.events()
        self.assertEqual(event["run_id"], "run_cost_test")
        self.assertEqual(event["action"], "risks")
        self.assertEqual(event["provider"], "openai")
        self.assertEqual(event["model"], "gpt-6-sol")
        self.assertEqual(event["attempt"], 1)
        self.assertEqual(event["round_index"], 0)
        self.assertEqual(event["call_index"], 1)
        self.assertGreaterEqual(event["elapsed_ms"], 0)
        self.assertEqual(event["raw_usage"], reply.usage.model_dump())
        self.assertEqual(Decimal(event["cost_usd"]), Decimal("0.0004"))
        report = self.report()
        self.assertEqual(report["total"]["calls"], 1)
        self.assertEqual(report["total"]["unpriced_calls"], 0)
        csv = (self.directory / "run_cost_test" / "report.csv").read_text(encoding="utf-8-sig")
        self.assertIn("known_subtotal_usd", csv)
        self.assertIn("run_cost_test", csv)
        for path in (self.directory / "run_cost_test").iterdir():
            self.assertNotIn(PRIVATE, path.read_text(encoding="utf-8-sig"))
            self.assertNotIn("synthetic-test-key", path.read_text(encoding="utf-8-sig"))

    def test_error_retry_and_each_tool_round_are_recorded_once(self):
        failure = APIConnectionError(message=PRIVATE,
                                     request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
        tool = DumpObject(type="function_call", id="fc_fake", call_id="call_fake",
                          name="get_clause", arguments=json.dumps({"source_id": "source_fake"}))
        runner = self.runner(failure, response("resp_tool", output=[tool], text=""),
                             response("resp_final"))
        with patch.object(runner, "execute_tool", return_value={"text": PRIVATE}) as execute:
            self.request(runner, tools=True)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(len(runner.client.requests), 3)
        self.assertEqual([(e["round_index"], e["attempt"], e["call_index"])
                          for e in self.events()], [(0, 1, 1), (0, 2, 2), (1, 1, 3)])
        first, second, third = self.events()
        self.assertEqual(first["status"], "error")
        self.assertEqual(first["error_type"], "APIConnectionError")
        self.assertIsNone(first["cost_usd"])
        self.assertEqual(second["status"], "ok")
        total = self.report()["total"]
        self.assertEqual(total["calls"], 3)
        self.assertEqual(total["retry_attempts"], 1)
        self.assertEqual(total["unpriced_calls"], 1)
        self.assertFalse(total["cost_complete"])
        self.assertEqual(Decimal(total["known_subtotal_usd"]), Decimal("0.0008"))
        self.assertNotIn(PRIVATE, json.dumps(self.events()))
        self.assertNotIn(PRIVATE, self.stderr.getvalue())

    def test_non_transient_error_does_not_retry(self):
        failure = APIStatusError(PRIVATE, response=httpx.Response(
            400, request=httpx.Request("POST", "https://api.openai.com/v1/responses")),
            body={"private": PRIVATE})
        runner = self.runner(failure)
        with self.assertRaises(agent._Stopped):
            self.request(runner)
        self.assertEqual(len(runner.client.requests), 1)
        event, = self.events()
        self.assertEqual(event["error_type"], "APIStatusError")
        self.assertEqual(event["status"], "error")
        self.assertIsNone(event["cost_usd"])

    def test_retry_limit_and_api_call_limit_are_unchanged(self):
        def error():
            return APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/responses"))

        runner = self.runner(error(), error())
        with self.assertRaises(agent._Stopped):
            self.request(runner)
        self.assertEqual(len(runner.client.requests), 2)
        self.assertEqual([e["attempt"] for e in self.events()], [1, 2])
        limited = self.runner(error(), run_id="run_limited", max_calls=1)
        with self.assertRaises(agent._Stopped):
            self.request(limited)
        self.assertEqual(len(limited.client.requests), 1)
        self.assertEqual(len(self.events("run_limited")), 1)

    def test_cache_read_write_long_context_and_service_tier_use_openai_rates(self):
        reply = response(tokens=usage(300000, 500, 100000, 20000), tier="priority")
        self.request(self.runner(reply))
        event, = self.events()
        self.assertEqual(Decimal(event["cost_usd"]), Decimal("1.735"))
        self.assertTrue(event["rate_snapshot"]["long_context_applied"])
        self.assertEqual(event["service_tier"], "priority")
        self.assertEqual(Decimal(event["rate_breakdown"]["cache_read_usd"]), Decimal("0.08"))
        self.assertEqual(Decimal(event["rate_breakdown"]["cache_write_usd"]), Decimal("0.2"))
        self.assertIn("developers.openai.com", event["rate_snapshot"]["source"])
        self.assertNotIn("openrouter", json.dumps(event).lower())

    def test_context_threshold_and_flex_tier(self):
        self.request(self.runner(response(tokens=usage(272000, 20), tier="flex")))
        event, = self.events()
        self.assertFalse(event["rate_snapshot"]["long_context_applied"])
        self.assertEqual(Decimal(event["cost_usd"]), Decimal("0.2721"))

    def test_missing_usage_is_explicitly_unknown_and_result_survives(self):
        parsed = self.request(self.runner(response(tokens=None)))
        self.assertEqual(parsed.findings, [])
        event, = self.events()
        self.assertIsNone(event["raw_usage"])
        self.assertIsNone(event["cost_usd"])
        self.assertEqual(event["cost_basis"], "unknown")
        self.assertEqual(self.report()["total"]["missing_usage_calls"], 1)
        self.assertFalse(self.report()["total"]["cost_complete"])

    def test_unknown_model_and_tier_are_never_priced_as_sol_default(self):
        for run_id, kwargs in (("run_unknown_model", {"model": "unlisted-model"}),
                               ("run_unknown_tier", {"tier": "unlisted-tier"})):
            with self.subTest(run_id=run_id):
                self.request(self.runner(response(**kwargs), run_id=run_id))
                event, = self.events(run_id)
                self.assertIsNone(event["cost_usd"])
                self.assertEqual(self.report(run_id)["total"]["unpriced_calls"], 1)

    def test_metric_write_failure_warns_without_retry_or_lost_model_result(self):
        from agent_costs.cost_tracker import Tracker
        runner = self.runner(response())
        with patch.object(Tracker, "record", side_effect=OSError(PRIVATE)):
            parsed = self.request(runner)
        self.assertEqual(parsed.findings, [])
        self.assertEqual(len(runner.client.requests), 1)
        self.assertEqual(runner.calls, 1)
        self.assertIn("agent_costs", self.stderr.getvalue())
        self.assertIn("OSError", self.stderr.getvalue())
        self.assertNotIn(PRIVATE, self.stderr.getvalue())

    def test_report_write_failure_after_event_append_preserves_response_and_retry_count(self):
        from agent_costs import cost_tracker
        runner = self.runner(response("resp_report_failure"), response("resp_after_recovery"))
        with patch.object(cost_tracker, "write_json", side_effect=OSError(PRIVATE)):
            parsed = self.request(runner)
        self.assertEqual(parsed.findings, [])
        self.assertEqual(runner.calls, 1)
        self.assertEqual(len(runner.client.requests), 1)
        self.assertEqual(len(self.events()), 1)
        self.assertIn("OSError", self.stderr.getvalue())
        self.assertNotIn(PRIVATE, self.stderr.getvalue())
        self.request(runner)
        self.assertEqual(len(runner.client.requests), 2)
        total = self.report()["total"]
        self.assertEqual(total["calls"], 2)
        self.assertEqual(total["retry_attempts"], 0)
        self.assertGreaterEqual(total["observer_errors"], 1)
        self.assertFalse(total["cost_complete"])
        self.assertEqual(Decimal(total["known_subtotal_usd"]), Decimal("0.0008"))

    def test_corrupt_observer_error_counter_cannot_break_checkpoint_or_result(self):
        runner = self.runner(response())
        parsed = self.request(runner)
        path = self.directory / "run_cost_test" / "report.json"
        report = self.report()
        report["observer_errors"] = "CORRUPT_COUNTER"
        corrupted = json.dumps(report).replace('"CORRUPT_COUNTER"', "1e309")
        path.write_text(corrupted, encoding="utf-8")
        runner.checkpoint("partial")
        self.assertEqual(parsed.findings, [])
        self.assertEqual(runner.calls, 1)
        self.assertEqual(len(runner.client.requests), 1)
        snapshot = runner.result.usage["cost_tracking"]
        self.assertFalse(snapshot["cost_complete"])
        self.assertGreaterEqual(snapshot["observer_errors"], 1)
        self.assertIn("OverflowError", self.stderr.getvalue())

    def test_unexpected_base_url_never_uses_direct_openai_rates(self):
        with patch.dict(os.environ, {"OPENAI_BASE_URL": "https://unexpected.example/v1"}):
            runner = self.runner(response())
            self.request(runner)
        self.assertEqual(len(runner.client.requests), 1)
        event, = self.events()
        self.assertIsNone(event["cost_usd"])
        self.assertEqual(event["cost_basis"], "unknown")
        self.assertIsNone(event["rate_snapshot"])
        self.assertEqual(self.report()["total"]["unpriced_calls"], 1)

    def test_concurrent_observers_preserve_all_events_and_cumulative_report(self):
        def record(index):
            observer = costs.RunCosts("run_cost_test")
            observer.record("risks", "gpt-6-sol", response(f"resp_parallel_{index}"),
                            1.0, attempt=1, round_index=0, call_index=1)

        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(record, range(12)))
        events = self.events()
        self.assertEqual(len(events), 12)
        self.assertEqual(len({event["response_id"] for event in events}), 12)
        self.assertEqual(self.report()["total"]["calls"], 12)
        self.assertEqual(Decimal(self.report()["total"]["known_subtotal_usd"]), Decimal("0.0048"))
        self.assertEqual(self.report()["observer_errors"], 0)
        self.assertTrue(self.report()["total"]["cost_complete"])

    def test_disabled_tracking_does_not_create_output_or_change_requests(self):
        with patch.dict(os.environ, {"LAB_COST_TRACKING": "0"}):
            runner = self.runner(response())
            self.request(runner)
        self.assertEqual(len(runner.client.requests), 1)
        self.assertFalse(list(self.directory.iterdir()))

    def test_reports_are_updated_after_each_response_and_persist_across_runners(self):
        self.request(self.runner(response("resp_one")))
        self.assertEqual(self.report()["total"]["calls"], 1)
        self.request(self.runner(response("resp_two")))
        self.assertEqual(self.report()["total"]["calls"], 2)
        self.assertEqual(Decimal(self.report()["total"]["known_subtotal_usd"]), Decimal("0.0008"))

    def test_translation_appends_to_same_run_and_keeps_stage(self):
        self.request(self.runner(response("resp_analysis")))
        finding = Finding(id="finding_fake", title="Title", change_type="review",
                          issue_type="uncertainty", before_function_ids=[], after_function_ids=[],
                          explanation="Explanation", recommendation="Recommendation", evidence=[])
        text = json.dumps({"findings": [{"id": finding.id, "title": "Translated",
                                        "explanation": "Translated explanation",
                                        "recommendation": "Translated recommendation"}]})
        client = ScriptedClient(response("resp_translation", text=text))
        self.factory.return_value = client
        translated = agent.translate_result(AgentResult(findings=[finding]), "en", "gpt-6-sol",
                                             run_id="run_cost_test")
        self.assertEqual(translated["findings"][0]["id"], finding.id)
        self.assertEqual([event["action"] for event in self.events()], ["risks", "translation"])
        self.assertEqual(self.report()["total"]["calls"], 2)
        self.assertEqual(len(client.requests), 1)
        self.assertTrue(client.closed)

    def test_shared_pipeline_forwards_actual_run_id_to_agent(self):
        store = MemoryStore()
        with patch.object(agent, "run_agent", return_value=AgentResult(complete=True)) as run_agent:
            value = pipeline.execute_run(store, store.value["id"], Settings(model="gpt-6-sol"))
        self.assertEqual(run_agent.call_args.kwargs["run_id"], store.value["id"])
        self.assertEqual(value["state"], "completed")

    def test_saved_translation_forwards_run_id_and_cache_avoids_extra_call(self):
        store = MemoryStore()
        store.value.update(state="completed", findings=[{
            "id": "finding_memory", "title": "Title", "change_type": "review",
            "issue_type": "uncertainty", "before_function_ids": [], "after_function_ids": [],
            "explanation": "Explanation", "recommendation": "Recommendation", "evidence": [],
        }])
        translation = {"locale": "en", "findings": [{"id": "finding_memory", "title": "Translated",
                                                     "explanation": "Translated explanation",
                                                     "recommendation": "Translated recommendation"}]}
        with patch.object(agent, "translate_result", return_value=translation) as translate:
            first = pipeline.translate_saved(store, store.value["id"], "en", Settings(model="gpt-6-sol"))
            second = pipeline.translate_saved(store, store.value["id"], "en", Settings(model="gpt-6-sol"))
        self.assertEqual(first, second)
        self.assertEqual(translate.call_count, 1)
        self.assertEqual(translate.call_args.kwargs["run_id"], store.value["id"])

    def test_api_start_uses_the_same_pipeline_and_real_run_id(self):
        from delphi_lab import api
        store = MemoryStore("run_api_fake")

        async def start_and_finish():
            with patch.object(api.app.state, "store", store, create=True), \
                    patch.object(api.app.state, "settings", Settings(model="gpt-6-sol"), create=True), \
                    patch.object(api.app.state, "tasks", set(), create=True), \
                    patch.object(agent, "run_agent", return_value=AgentResult(complete=True)) as call:
                started = await api.start("analysis_memory", api.RunInput(mode="live"))
                await asyncio.gather(*list(api.app.state.tasks))
                self.assertEqual(started["run_id"], "run_api_fake")
                self.assertEqual(call.call_args.kwargs["run_id"], "run_api_fake")
                self.assertEqual(store.value["state"], "completed")

        asyncio.run(start_and_finish())

    def test_cli_live_demo_uses_shared_pipeline_with_real_run_id(self):
        from delphi_lab import __main__ as cli
        store = MemoryStore("run_cli_fake")
        with patch.object(cli, "Store", return_value=store), \
                patch.object(cli, "Settings", return_value=Settings(model="gpt-6-sol")), \
                patch.object(cli, "RuntimeLock", return_value=Mock()), \
                patch.object(cli, "upload_paths", return_value=[]), \
                patch.object(cli, "export", return_value={"state": "completed"}), \
                patch.object(cli, "dump"), \
                patch.object(agent, "run_agent", return_value=AgentResult(complete=True)) as call, \
                patch("sys.argv", ["delphi_lab", "demo", "--mode", "live", "--fixture", "en"]):
            self.assertEqual(cli.main(), 0)
        self.assertEqual(call.call_args.kwargs["run_id"], "run_cli_fake")

    def test_cli_prints_saved_cost_summary_even_if_export_fails(self):
        from delphi_lab import __main__ as cli
        store = MemoryStore("run_cli_export_failure")
        scripted_runner = self.runner(response("resp_before_export_failure"),
                                      run_id=store.value["id"])

        def fake_analysis(documents, **kwargs):
            self.assertEqual(kwargs["run_id"], store.value["id"])
            self.request(scripted_runner)
            return AgentResult(complete=True)

        with patch.object(cli, "Store", return_value=store), \
                patch.object(cli, "Settings", return_value=Settings(model="gpt-6-sol")), \
                patch.object(cli, "RuntimeLock", return_value=Mock()), \
                patch.object(cli, "upload_paths", return_value=[]), \
                patch.object(cli, "export", side_effect=OSError("Synthetic export failure")), \
                patch.object(cli, "dump"), \
                patch.object(agent, "run_agent", side_effect=fake_analysis), \
                patch("sys.argv", ["delphi_lab", "demo", "--mode", "live", "--fixture", "en"]):
            self.assertEqual(cli.main(), 1)
        self.assertEqual(store.value["state"], "completed")
        self.assertEqual(len(scripted_runner.client.requests), 1)
        subtotal = self.report(store.value["id"])["total"]["known_subtotal_usd"]
        self.assertIn(str(self.directory / store.value["id"] / "report.json"), self.stderr.getvalue())
        self.assertIn(f"Known subtotal USD={subtotal}", self.stderr.getvalue())

    def test_old_launcher_cannot_install_a_second_observer_or_run_cli(self):
        from agent_costs import lab_run
        from delphi_lab import __main__ as cli
        with patch.object(cli, "main") as main, \
                patch.object(lab_run.Observer, "installed") as installed, \
                patch.object(sys, "path", sys.path.copy()), \
                patch.object(sys, "dont_write_bytecode", True):
            code = lab_run.main(["--", "demo", "--mode", "live"])
        self.assertEqual(code, 2)
        main.assert_not_called()
        installed.assert_not_called()
        self.factory.assert_not_called()
        self.assertIn("double accounting", self.stderr.getvalue())

    def test_import_from_lab_without_pythonpath(self):
        lab = Path(__file__).resolve().parents[1]
        environment = dict(os.environ)
        environment.pop("PYTHONPATH", None)
        completed = subprocess.run([
            sys.executable, "-B", "-c",
            "import delphi_lab.agent; import agent_costs.cost_tracker; print('IMPORT_OK')",
        ], cwd=lab, env=environment, capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), "IMPORT_OK")

    @unittest.skipUnless(os.name == "nt", "Windows run.ps1 smoke check")
    def test_run_ps1_help_works_without_pythonpath_or_launcher(self):
        lab = Path(__file__).resolve().parents[1]
        environment = dict(os.environ)
        environment.pop("PYTHONPATH", None)
        completed = subprocess.run([
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            str(lab / "run.ps1"), "--help",
        ], cwd=self.directory, env=environment, capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("demo", completed.stdout)
        self.assertFalse(list(self.directory.iterdir()))


if __name__ == "__main__":
    unittest.main()
