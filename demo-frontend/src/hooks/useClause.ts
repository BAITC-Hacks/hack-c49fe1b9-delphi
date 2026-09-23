import { useEffect, useState } from "react";
import { getClause } from "@/lib/api";
import type { Clause, ClauseRef } from "@/types";

export function useClause(ref: ClauseRef | undefined, analysisId: string) {
  const [clause, setClause] = useState<Clause | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!ref);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getClause(analysisId, ref.document_id, ref.clause_id)
      .then((c) => {
        if (!cancelled) setClause(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить пункт");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ref?.document_id, ref?.clause_id, analysisId, attempt]);

  return { clause, error, loading, reload: () => setAttempt((a) => a + 1) };
}
