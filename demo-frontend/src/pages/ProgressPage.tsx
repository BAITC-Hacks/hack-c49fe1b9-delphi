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
  const demoRun = !!runId?.startsWith("demo:");

  const onRetry = async () => {
    const next = await retry();
    if (next) navigate(`/runs/${encodeURIComponent(next)}`, { replace: true });
  };

  return (
    <AppShell showNew={false}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {(error || timedOut) && (
          <Alert variant={timedOut ? "default" : "destructive"}>
            <AlertTitle>{timedOut ? "Анализ идёт дольше обычного" : demoRun ? "Не удалось открыть пример" : "Не удалось получить статус"}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{timedOut ? "Сервер не ответил за 10 минут. Можно подождать или открыть пример." : error}</span>
              <Button size="sm" variant="outline" onClick={() => navigate(`/analyses/${DEMO_ID}`)}>
                Открыть пример
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate("/history")}>
                К истории
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {demoRun && job && !error && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Пример: воспроизводим ход сохранённого анализа. Модель не вызывается.
          </p>
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
        {!job && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            {demoRun ? "Проверяем доступность сохранённого примера…" : "Получаем статус анализа…"}
          </p>
        )}
        {job && !error && <AnalysisProgress
          stage={job.stage}
          stageState={job.stage_state}
          counters={job.counters}
          onCancel={() => navigate("/history")}
          onRetryStage={job?.analysis_id && !demoRun ? onRetry : undefined}
          hint={demoRun ? "Воспроизведение сохранённого анализа занимает несколько секунд." : undefined}
        />}
      </div>
    </AppShell>
  );
}
