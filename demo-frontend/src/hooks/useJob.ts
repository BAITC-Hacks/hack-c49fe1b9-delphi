import { useCallback, useEffect, useRef, useState } from "react";
import { getRun, repeatRun } from "@/lib/api";
import type { JobStatus } from "@/types";

const POLL_MS = 2000; // architecture.md: UI polls about every two seconds
const TIMEOUT_MS = 11 * 60 * 1000; // backend RUN_TIMEOUT_SECONDS is 600 s; allow a minute of slack

/** Polls a run until it produces a result (JobStatus.result_id), fails or is interrupted. */
export function useJob(runId: string | undefined) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    startedAt.current = Date.now();
    setTimedOut(false);

    const tick = async () => {
      try {
        const next = await getRun(runId);
        if (stopped) return;
        setJob(next);
        setError(null);
        // finished (caller navigates away) or terminal failure: stop polling
        if (next.result_id || next.stage_state === "failed" || next.stage_state === "interrupted") return;
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : "Не удалось получить статус");
      }
      if (Date.now() - startedAt.current > TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  /** Repeats the analysis with the same documents and options; resolves to the new run id. */
  const retry = useCallback(async (): Promise<string | undefined> => {
    if (!job?.analysis_id) return undefined;
    try {
      return await repeatRun(job.analysis_id, job.allow_partial ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось повторить анализ");
      return undefined;
    }
  }, [job?.analysis_id, job?.allow_partial]);

  return { job, error, timedOut, retry };
}
