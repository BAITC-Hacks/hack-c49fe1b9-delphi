import { useCallback, useEffect, useRef, useState } from "react";
import { getRun, retryStage as apiRetryStage } from "@/lib/api";
import type { JobStatus } from "@/types";

const POLL_MS = 2000; // architecture.md: UI polls about every two seconds
const TIMEOUT_MS = 8 * 60 * 1000;

/** Polls a run until it produces a result (JobStatus.result_id) or fails. */
export function useJob(runId: string | undefined) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await getRun(runId);
        if (stopped) return;
        setJob(next);
        setError(null);
        if (next.result_id) return; // finished: caller navigates away
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

  const retryStage = useCallback(async () => {
    if (!runId) return;
    try {
      const next = await apiRetryStage(runId);
      setJob(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось перезапустить стадию");
    }
  }, [runId]);

  return { job, error, timedOut, retryStage };
}
