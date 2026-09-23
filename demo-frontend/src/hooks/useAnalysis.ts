import { useCallback, useEffect, useState } from "react";
import { getAnalysis } from "@/lib/api";
import type { AnalysisResult } from "@/types";

export function useAnalysis(id: string | undefined) {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getAnalysis(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить результат");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, replace: setData };
}
