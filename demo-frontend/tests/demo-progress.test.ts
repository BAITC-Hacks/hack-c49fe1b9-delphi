import test from "node:test";
import assert from "node:assert/strict";
import { replayDemoRun, resolveRunTarget } from "@/hooks/useJob";
import type { AnalysisResult, JobStatus } from "@/types";

const savedResult = { units: [], functions: [], risks: [] } as unknown as AnalysisResult;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("demo-only progress rejects unknown run IDs before choosing any backend request", () => {
  assert.equal(resolveRunTarget("unknown", true).kind, "error");
  assert.equal(resolveRunTarget(undefined, true).kind, "error");
  assert.equal(resolveRunTarget("demo:unknown", true).kind, "error");
  assert.equal(resolveRunTarget("demo:unknown", false).kind, "error");
  assert.deepEqual(resolveRunTarget("demo:demo-conflict", true), { kind: "demo", caseId: "demo-conflict" });
  assert.deepEqual(resolveRunTarget("live-run", false), { kind: "live", runId: "live-run" });
});

test("invalid demo replay neither loads data nor emits successful stages", async () => {
  let loads = 0;
  const jobs: JobStatus[] = [];
  const errors: string[] = [];
  replayDemoRun("demo:unknown", (job) => jobs.push(job), (error) => errors.push(error), async () => { loads++; return savedResult; });
  await flush();
  assert.equal(loads, 0);
  assert.deepEqual(jobs, []);
  assert.match(errors[0], /Пример не найден/);
});

test("failed saved-result load reports an error without replaying stages", async () => {
  const jobs: JobStatus[] = [];
  const errors: string[] = [];
  replayDemoRun("demo:demo", (job) => jobs.push(job), (error) => errors.push(error), async () => { throw new Error("Файл недоступен"); });
  await flush();
  assert.deepEqual(jobs, []);
  assert.deepEqual(errors, ["Файл недоступен"]);
});

test("successful replay waits for the saved result and emits all five stages", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const jobs: JobStatus[] = [];
  let resolve!: (result: AnalysisResult) => void;
  const loaded = new Promise<AnalysisResult>((done) => { resolve = done; });
  const stop = replayDemoRun("demo:demo", (job) => jobs.push(job), assert.fail, () => loaded);
  t.mock.timers.tick(10000);
  assert.deepEqual(jobs, []);
  resolve(savedResult);
  await flush();
  assert.equal(jobs[0].stage, 1);
  for (let step = 0; step < 5; step++) t.mock.timers.tick(750);
  assert.deepEqual(jobs.map((job) => job.stage), [1, 2, 3, 4, 5, 5]);
  assert.equal(jobs.at(-1)?.result_id, "demo");
  assert.equal(jobs.at(-1)?.stage_state, "done");
  stop();
});

test("leaving replay ignores a late load response and a late error", async () => {
  let resolve!: (result: AnalysisResult) => void;
  let reject!: (error: Error) => void;
  const loaded = new Promise<AnalysisResult>((done) => { resolve = done; });
  const failed = new Promise<AnalysisResult>((_, fail) => { reject = fail; });
  const stopLoad = replayDemoRun("demo:demo", assert.fail, assert.fail, () => loaded);
  const stopError = replayDemoRun("demo:demo-transfer", assert.fail, assert.fail, () => failed);
  stopLoad();
  stopError();
  resolve(savedResult);
  reject(new Error("Late failure"));
  await flush();
});

test("leaving an active replay stops its scheduled stages", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const jobs: JobStatus[] = [];
  const stop = replayDemoRun("demo:demo", (job) => jobs.push(job), assert.fail, async () => savedResult);
  await flush();
  assert.equal(jobs.length, 1);
  stop();
  t.mock.timers.tick(10000);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].result_id, undefined);
});
