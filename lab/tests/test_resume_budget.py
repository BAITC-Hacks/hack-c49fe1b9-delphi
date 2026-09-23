"""Resume and monetary-cap checks use synthetic SDK results and temporary ledgers."""
from __future__ import annotations

from contextlib import ExitStack, redirect_stderr
from copy import deepcopy
from decimal import Decimal
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import Mock, patch

import httpx
from openai import APIConnectionError

from delphi_lab import agent, costs, pipeline
from delphi_lab.config import Settings
from delphi_lab.models import AgentResult, Document, Evidence, Finding, Function, SourceBlock

from test_cost_tracking import MemoryStore, ScriptedClient, response, usage


def documents():
    result = []
    for side, count in (("before", 2), ("after", 1)):
        doc_id = f"doc_{side}"
        blocks = [SourceBlock(
            id=f"{side}_{index}", document_id=doc_id, side=side,
            locator=f"line:{index}", original_text=f"Synthetic {side} duty {index}",
            normalized_text=f"synthetic {side} duty {index}",
            parent_id="before_1" if side == "before" and index == 2 else None,
        ) for index in range(1, count + 1)]
        result.append(Document(id=doc_id, side=side, filename=f"{side}.md", sha256="synthetic",
                               format="md", detected_language="en", parse_status="ok", blocks=blocks))
    return result


def extracted_function():
    return Function(id="function_saved", side="before", owner_unit_ids=[],
                    actor_original="Synthetic department", action="Reviews", object="Synthetic report",
                    scope="", condition="", modality="must", source_ids=["before_1"])


def saved_result():
    return AgentResult(
        functions=[extracted_function()],
        usage={"model": "gpt-6-sol", "api_calls": 7, "input_tokens": 10000,
               "output_tokens": 20, "total_tokens": 10020, "elapsed_seconds": 12},
        coverage={"blocks_total": 3, "blocks_processed": 1,
                  "unprocessed_source_ids": ["before_2", "after_1"],
                  "unprocessed_before_function_ids": ["function_saved"],
                  "unprocessed_after_risk_function_ids": [], "unmatched_sweeps": {}},
        errors=["Historical extraction failure"],
    )


class ResumeStore(MemoryStore):
    def __init__(self):
        super().__init__("run_resume_fake")
        self.docs = documents()
        prior = saved_result()
        finding = Finding(id=f'{self.value["id"]}__finding_saved', title="Synthetic review",
                          change_type="review", issue_type="uncertainty",
                          before_function_ids=["function_saved"], after_function_ids=[],
                          explanation="Synthetic explanation", recommendation="Synthetic recommendation",
                          evidence=[Evidence(source_id="before_1", evidence_role="before")])
        prior.findings = [finding]
        self.value.update(prior.model_dump(exclude={"complete"}))
        self.value.update(state="partial", stage="finished", immutable_document_ids=[d.id for d in self.docs],
                          review_revision=0, diff={"complete": True})
        self.value["findings"][0].update(review={"status": "unreviewed", "note": ""},
                                         source_ids=["before_1"])

    def documents(self, run_id):
        return deepcopy(self.docs)

    def list_analyses(self):
        return [{"id": "analysis_memory", "run_id": self.value["id"], "state": self.value["state"]}]


class ResumeBudgetTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(costs, "OUTPUT_ROOT", self.directory))
        self.stack.enter_context(patch.dict(os.environ, {
            "OPENAI_API_KEY": "synthetic-resume-test-key", "OPENAI_BASE_URL": "https://api.openai.com/v1",
            "LAB_COST_TRACKING": "1", "LAB_COST_BUDGET_USD": "",
        }))
        self.stack.enter_context(patch.object(socket.socket, "connect",
                                             side_effect=AssertionError("No external calls in resume tests")))
        self.factory = self.stack.enter_context(patch("openai.OpenAI"))
        self.stack.enter_context(patch.object(agent.time, "sleep"))
        self.stderr = io.StringIO()
        self.stack.enter_context(redirect_stderr(self.stderr))

    def runner(self, *outcomes, run_id="run_budget_fake"):
        runner = agent._Runner([], "gpt-6-sol", "en", 40, 5000, 16000, 4, 900, None, run_id=run_id)
        runner.client = ScriptedClient(*outcomes)
        return runner

    def request(self, runner):
        return runner.request("risks", {}, agent._Risks)

    def events(self, run_id="run_budget_fake"):
        path = self.directory / run_id / "events.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []

    def record_history(self, reply):
        costs.RunCosts("run_budget_fake").record("extract", "gpt-6-sol", reply, 1.0,
                                                 attempt=1, round_index=0, call_index=1)

    def test_resume_skips_processed_primary_blocks_and_keeps_cumulative_calls(self):
        before = response("resp_resume_before", text=json.dumps({
            "units": [], "functions": [], "processed_source_ids": ["before_2"]}))
        after = response("resp_resume_after", text=json.dumps({
            "units": [], "functions": [], "processed_source_ids": ["after_1"]}))
        client = ScriptedClient(before, after)
        self.factory.return_value = client

        def mark_compared(runner):
            runner.compared.update(f.id for f in runner.result.functions if f.side == "before")

        with patch.object(agent._Runner, "compare", mark_compared), patch.object(agent._Runner, "risks"):
            result = agent.run_agent(documents(), model="gpt-6-sol", language="en", max_calls=40,
                                     run_id="run_resume_fake", resume_result=saved_result())
        self.assertEqual(len(client.requests), 2)
        payloads = [json.loads(request["input"][0]["content"]) for request in client.requests]
        self.assertEqual([[block["id"] for block in payload["primary_blocks"]] for payload in payloads],
                         [["before_2"], ["after_1"]])
        self.assertIn("before_1", [block["id"] for block in payloads[0]["context_blocks"]])
        self.assertEqual(result.usage["api_calls"], 9)
        self.assertEqual(result.usage["input_tokens"], 10200)
        self.assertGreaterEqual(result.usage["elapsed_seconds"], 12)
        self.assertEqual(result.coverage["blocks_processed"], 3)
        self.assertEqual(result.coverage["unprocessed_source_ids"], [])
        self.assertEqual([function.id for function in result.functions], ["function_saved"])
        self.assertEqual([event["call_index"] for event in self.events("run_resume_fake")], [8, 9])
        self.assertNotIn("Historical extraction failure", result.errors)
        self.assertTrue(any(event.get("operation") == "resume" for event in result.trace))

    def test_resume_cumulative_call_limit_does_not_start_an_extra_request(self):
        client = ScriptedClient()
        self.factory.return_value = client
        result = agent.run_agent(documents(), model="gpt-6-sol", max_calls=7,
                                 run_id="run_resume_limited", resume_result=saved_result())
        self.assertEqual(client.requests, [])
        self.assertEqual(result.usage["api_calls"], 7)
        self.assertEqual(result.coverage["blocks_processed"], 1)
        self.assertTrue(result.errors)

    def test_pipeline_resume_unprefixes_once_and_saves_one_prefix(self):
        store = ResumeStore()

        def continue_run(documents, **kwargs):
            prior = kwargs["resume_result"]
            self.assertEqual(prior.findings[0].id, "finding_saved")
            self.assertEqual(kwargs["run_id"], store.value["id"])
            prior.complete = True
            kwargs["on_progress"]({"stage": "risks", "result": prior.model_dump(mode="json")})
            return prior

        with patch.object(agent, "run_agent", side_effect=continue_run) as call:
            result = pipeline.execute_run(store, store.value["id"], Settings(model="gpt-6-sol"), resume=True)
        self.assertEqual(call.call_count, 1)
        self.assertEqual(result["findings"][0]["id"], "run_resume_fake__finding_saved")
        self.assertNotIn("run_resume_fake__run_resume_fake", json.dumps(result))

    def test_resume_rejects_changed_model_or_document_set_before_api(self):
        for changed in ("model", "documents"):
            with self.subTest(changed=changed):
                store = ResumeStore()
                settings = Settings(model="different-model" if changed == "model" else "gpt-6-sol")
                if changed == "documents":
                    store.value["immutable_document_ids"] = ["unexpected_document"]
                with patch.object(agent, "run_agent") as call:
                    with self.assertRaises(ValueError):
                        pipeline.execute_run(store, store.value["id"], settings, resume=True)
                call.assert_not_called()

    def test_resume_rejects_running_run(self):
        store = ResumeStore()
        store.value["state"] = "running"
        with patch.object(agent, "run_agent") as call:
            with self.assertRaises(ValueError):
                pipeline.execute_run(store, store.value["id"], Settings(model="gpt-6-sol"), resume=True)
        call.assert_not_called()

    def test_cap_checks_prior_spend_before_invocation(self):
        self.record_history(response("resp_historical", tokens=usage(2497500, 0)))
        self.assertEqual(Decimal(self.events()[0]["cost_usd"]), Decimal("9.99"))
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": "10"}):
            runner = self.runner(response())
            with self.assertRaises((ValueError, agent._Stopped)):
                self.request(runner)
        self.assertEqual(len(runner.client.requests), 0)
        self.assertEqual(len(self.events()), 1)

    def test_insufficient_initial_budget_never_invokes_sdk(self):
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": "0.0000001"}):
            runner = self.runner(response())
            with self.assertRaises((ValueError, agent._Stopped)):
                self.request(runner)
        self.assertEqual(len(runner.client.requests), 0)
        self.assertEqual(self.events(), [])

    def test_tracking_disabled_cannot_bypass_explicit_cap(self):
        with patch.dict(os.environ, {"LAB_COST_TRACKING": "0", "LAB_COST_BUDGET_USD": "10"}):
            runner = self.runner(response())
            with self.assertRaises((ValueError, agent._Stopped)):
                self.request(runner)
        self.assertEqual(len(runner.client.requests), 0)

    def test_unknown_historical_cost_blocks_new_paid_attempt(self):
        self.record_history(response("resp_usage_missing", tokens=None))
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": "10"}):
            runner = self.runner(response())
            with self.assertRaises((ValueError, agent._Stopped)):
                self.request(runner)
        self.assertEqual(len(runner.client.requests), 0)
        self.assertEqual(len(self.events()), 1)

    def test_success_with_cap_records_actual_cost_and_releases_reservation(self):
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": "10"}):
            runner = self.runner(response("resp_cap_1"), response("resp_cap_2"))
            self.request(runner)
            self.request(runner)
        self.assertEqual(len(runner.client.requests), 2)
        self.assertEqual(len(self.events()), 2)
        report = json.loads((self.directory / "run_budget_fake" / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(Decimal(report["total"]["known_subtotal_usd"]), Decimal("0.0008"))
        budget = json.loads((self.directory / "run_budget_fake" / "budget.json").read_text(encoding="utf-8"))
        self.assertEqual(budget["pending_reservations"], {})

    def test_metric_failure_with_cap_retains_result_but_blocks_next_attempt(self):
        from agent_costs.cost_tracker import Tracker
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": "10"}):
            runner = self.runner(response("resp_unrecorded"), response("resp_must_not_call"))
            with patch.object(Tracker, "record", side_effect=OSError("Synthetic ledger failure")):
                parsed = self.request(runner)
            self.assertEqual(parsed.findings, [])
            with self.assertRaises((ValueError, agent._Stopped)):
                self.request(runner)
        self.assertEqual(len(runner.client.requests), 1)
        budget = json.loads((self.directory / "run_budget_fake" / "budget.json").read_text(encoding="utf-8"))
        self.assertEqual(len(budget["pending_reservations"]), 1)

    def test_unknown_retry_cost_with_cap_stops_before_second_attempt(self):
        failure = APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": "10"}):
            runner = self.runner(failure, response("resp_must_not_retry"))
            with self.assertRaises((ValueError, agent._Stopped)):
                self.request(runner)
        self.assertEqual(len(runner.client.requests), 1)
        self.assertEqual(len(self.events()), 1)
        self.assertIsNone(self.events()[0]["cost_usd"])

    def test_persisted_reservation_counts_for_a_new_observer(self):
        options = {"model": "gpt-6-sol", "input": [], "max_output_tokens": 5000}
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": "10"}):
            costs.RunCosts("run_budget_fake").check_budget(options)
        budget = json.loads((self.directory / "run_budget_fake" / "budget.json").read_text(encoding="utf-8"))
        reservation, = budget["pending_reservations"].values()
        ceiling = Decimal(reservation["reserved_usd"]) * Decimal("1.5")
        with patch.dict(os.environ, {"LAB_COST_BUDGET_USD": str(ceiling)}):
            with self.assertRaises(ValueError):
                costs.RunCosts("run_budget_fake").check_budget(options)
        self.factory.assert_not_called()

    def test_unset_cap_preserves_transient_retry_behavior(self):
        failure = APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
        runner = self.runner(failure, response("resp_retry"))
        self.request(runner)
        self.assertEqual(len(runner.client.requests), 2)
        self.assertEqual([event["attempt"] for event in self.events()], [1, 2])

    def test_cli_resume_forwards_limits_and_sets_cap(self):
        from delphi_lab import __main__ as cli
        store = ResumeStore()

        def continue_run(actual_store, run_id, settings, *, resume=False):
            self.assertIs(actual_store, store)
            self.assertEqual(run_id, store.value["id"])
            self.assertTrue(resume)
            self.assertEqual(settings.max_calls, 600)
            self.assertEqual(settings.timeout_seconds, 7200)
            self.assertEqual(Decimal(os.environ["LAB_COST_BUDGET_USD"]), Decimal("10"))
            return {**store.value, "state": "completed"}

        with patch.object(cli, "Store", return_value=store), \
                patch.object(cli, "Settings", return_value=Settings(model="gpt-6-sol")), \
                patch.object(cli, "RuntimeLock", return_value=Mock()), \
                patch.object(cli, "execute_run", side_effect=continue_run) as call, \
                patch.object(cli, "export", return_value={"state": "completed"}), \
                patch.object(cli, "dump"), \
                patch("sys.argv", ["delphi_lab", "resume", store.value["id"], "--max-calls", "600",
                                   "--timeout-seconds", "7200", "--cost-budget-usd", "10"]):
            self.assertEqual(cli.main(), 0)
        call.assert_called_once()


if __name__ == "__main__":
    unittest.main()
