import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { AppShell } from "@/components/layout/AppShell";
import { useJob } from "@/hooks/useJob";
import { DEMO_ID } from "@/lib/api";

export default function ProgressPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { job, error, retryError, timedOut, retry } = useJob(runId);

  useEffect(() => {
    if (job?.result_id) navigate(`/analyses/${encodeURIComponent(job.result_id)}`, { replace: true });
  }, [job?.result_id, navigate]);

  const stopped = job?.stage_state === "failed" || job?.stage_state === "interrupted";

  const onRetry = async () => {
    const next = await retry();
    if (next) navigate(`/runs/${encodeURIComponent(next)}`, { replace: true });
  };

  return (
    <AppShell showNew={false}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {(error || timedOut) && (
          <Alert variant={timedOut ? "default" : "destructive"}>
            <AlertTitle>{timedOut ? "Анализ идёт дольше обычного" : "Не удалось получить статус"}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{timedOut ? "Сервер не ответил за 10 минут. Можно подождать или открыть пример." : error}</span>
              <Button size="sm" variant="outline" onClick={() => navigate(`/analyses/${DEMO_ID}`)}>
                Открыть пример
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {retryError && (
          <Alert variant="destructive">
            <AlertTitle>Повтор не запущен</AlertTitle>
            <AlertDescription>{retryError}</AlertDescription>
          </Alert>
        )}
        {stopped && job?.error && (
          <Alert variant="destructive">
            <AlertTitle>{job.stage_state === "interrupted" ? "Анализ прерван" : "Анализ не завершён"}</AlertTitle>
            <AlertDescription>{job.error}</AlertDescription>
          </Alert>
        )}
        <AnalysisProgress
          stage={job?.stage ?? 1}
          stageState={job?.stage_state ?? "running"}
          counters={job?.counters}
          onCancel={() => navigate("/")}
          onRetryStage={job?.analysis_id ? onRetry : undefined}
        />
      </div>
    </AppShell>
  );
}
