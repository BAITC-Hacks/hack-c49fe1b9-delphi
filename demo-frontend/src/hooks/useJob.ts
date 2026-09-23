import { useCallback, useEffect, useRef, useState } from "react";
import { getAnalysis, getRun, repeatRun } from "@/lib/api";
import { DEMO_ONLY, isDemoId } from "@/lib/demo";
import type { AnalysisResult, JobStatus } from "@/types";

const POLL_MS = 2000; // architecture.md: UI polls about every two seconds
const TIMEOUT_MS = 11 * 60 * 1000; // backend RUN_TIMEOUT_SECONDS is 600 s; allow a minute of slack

type RunTarget = { kind: "demo"; caseId: string } | { kind: "live"; runId: string } | { kind: "error"; message: string };

export function resolveRunTarget(runId: string | undefined, demoOnly = DEMO_ONLY): RunTarget {
  if (runId?.startsWith("demo:")) {
    const caseId = runId.slice("demo:".length);
    return isDemoId(caseId)
      ? { kind: "demo", caseId }
      : { kind: "error", message: "Пример не найден. Выберите один из сохранённых примеров." };
  }
  if (!runId || demoOnly) return { kind: "error", message: "Пример не найден. В демо-версии доступны только сохранённые примеры." };
  return { kind: "live", runId };
}

/** Start playback only after the saved result loads; cancellation also guards late promises. */
export function replayDemoRun(
  runId: string,
  onJob: (job: JobStatus) => void,
  onError: (message: string) => void,
  load: (id: string) => Promise<AnalysisResult> = getAnalysis,
): () => void {
  const target = resolveRunTarget(runId, true);
  if (target.kind !== "demo") {
    onError(target.kind === "error" ? target.message : "Пример не найден.");
    return () => undefined;
  }
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  void load(target.caseId).then((result) => {
    if (stopped) return;
    const counters = {
      units: result.units.length,
      functions: result.functions.length,
      matched: result.functions.filter((f) => f.status !== "missing").length,
      risks: result.risks.length,
    };
    let stage = 1;
    const show = () => onJob({ id: runId, analysis_id: target.caseId, stage: stage as JobStatus["stage"], stage_state: "running", counters });
    show();
    timer = setInterval(() => {
      if (stopped) return;
      stage += 1;
      if (stage > 5) {
        clearInterval(timer);
        onJob({ id: runId, analysis_id: target.caseId, stage: 5, stage_state: "done", counters, result_id: target.caseId });
      } else show();
    }, 750);
  }).catch((e: unknown) => {
    if (!stopped) onError(e instanceof Error ? e.message : "Не удалось загрузить сохранённый пример.");
  });
  return () => { stopped = true; if (timer) clearInterval(timer); };
}

/** Polls a run until it produces a result (JobStatus.result_id), fails or is interrupted. */
export function useJob(runId: string | undefined) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    setJob(null);
    setError(null);
    setRetryError(null);
    setTimedOut(false);
    const target = resolveRunTarget(runId);
    if (target.kind === "error") { setError(target.message); return; }
    if (target.kind === "demo") return replayDemoRun(runId!, setJob, setError);

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    startedAt.current = Date.now();
    const tick = async () => {
      try {
        const next = await getRun(target.runId);
        if (stopped) return;
        setJob(next);
        setError(null);
        if (next.result_id || next.stage_state === "failed" || next.stage_state === "interrupted") return;
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : "Не удалось получить статус");
      }
      if (Date.now() - startedAt.current > TIMEOUT_MS) { setTimedOut(true); return; }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [runId]);

  /** Repeats analysis with the same documents and options; resolves the new run id. */
  const retry = useCallback(async (): Promise<string | undefined> => {
    if (!job?.analysis_id || job.id !== runId || DEMO_ONLY) return undefined;
    setRetryError(null);
    try {
      return await repeatRun(job.analysis_id, job.allow_partial ?? false);
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : "Не удалось повторить анализ");
      return undefined;
    }
  }, [job?.analysis_id, job?.allow_partial, job?.id, runId]);

  return { job: job?.id === runId ? job : null, error, retryError, timedOut, retry };
}
