import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { AppShell } from "@/components/layout/AppShell";
import { useJob } from "@/hooks/useJob";
import { cancelRun, DEMO_ID } from "@/lib/api";

export default function ProgressPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { job, error, timedOut, retryStage } = useJob(runId);

  useEffect(() => {
    if (job?.result_id) navigate(`/analyses/${encodeURIComponent(job.result_id)}`, { replace: true });
  }, [job?.result_id, navigate]);

  const cancel = async () => {
    if (runId) await cancelRun(runId);
    navigate("/");
  };

  return (
    <AppShell showNew={false}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {(error || timedOut) && (
          <Alert variant={timedOut ? "default" : "destructive"}>
            <AlertTitle>{timedOut ? "Анализ идёт дольше обычного" : "Не удалось получить статус"}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{timedOut ? "Сервер не ответил за 8 минут. Можно подождать или открыть пример." : error}</span>
              <Button size="sm" variant="outline" onClick={() => navigate(`/analyses/${DEMO_ID}`)}>
                Открыть пример
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <AnalysisProgress
          stage={job?.stage ?? 1}
          stageState={job?.stage_state ?? "running"}
          counters={job?.counters}
          onCancel={cancel}
          onRetryStage={retryStage}
        />
      </div>
    </AppShell>
  );
}
