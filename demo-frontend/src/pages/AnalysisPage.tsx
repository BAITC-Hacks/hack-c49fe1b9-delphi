import { reviewQueue, riskSummary } from "@/lib/evidence";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ListChecks, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppShell } from "@/components/layout/AppShell";
import { ConclusionReport } from "@/components/ConclusionReport";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { FunctionMapTable } from "@/components/FunctionMapTable";
import { RiskCard } from "@/components/RiskCard";
import { StatusChip } from "@/components/StatusChip";
import { TracePanel } from "@/components/TracePanel";
import { UnitTable } from "@/components/UnitTable";
import { useAnalysis } from "@/hooks/useAnalysis";
import { buildQueue } from "@/hooks/useReviewQueue";
import { DEMO_ID, saveReview } from "@/lib/api";
import { plural } from "@/lib/adapter";
import { UNIT_STATUS } from "@/lib/status";
import type { EvidenceRequest, ReviewStatus, UnitStatus } from "@/types";

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, error, loading, reload, replace } = useAnalysis(id);
  const [params, setParams] = useSearchParams();
  const findingId = params.get("finding");
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);

  useEffect(() => {
    if (data && findingId) setEvidence(reviewQueue(data).find((f) => f.finding_id === findingId) ?? null);
  }, [data, findingId]);
  /** Scenario H: stored on the server; the page is rebuilt from the saved bundle, not refetched. */
  const onReview = async (findingId: string, status: ReviewStatus, note: string) => {
    if (!id) return;
    const next = await saveReview(id, findingId, status, note);
    if (next) replace(next);
  };

  /** Questions still waiting for a human decision: the entry into the review queue. */
  const openQuestions = useMemo(
    () => (data ? buildQueue(data).filter((i) => i.question && i.review.status === "unreviewed").length : 0),
    [data],
  );

  const unitCounts = useMemo(() => {
    const counts: Partial<Record<UnitStatus, number>> = {};
    data?.units.forEach((u) => (counts[u.status] = (counts[u.status] ?? 0) + 1));
    return counts;
  }, [data]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Не удалось загрузить результат</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{error ?? "Пустой ответ сервера"}</span>
            <Button size="sm" variant="outline" onClick={reload}>
              Повторить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate(`/analyses/${DEMO_ID}`)}>
              Открыть пример
            </Button>
          </AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  const missingCount = data.functions.filter((f) => f.status === "missing").length;
  // More than half of the functions without a match usually means the sets are not comparable
  // (different documents, or a parsing failure), not a real mass loss. Say so.
  const suspiciousMissing = data.functions.length >= 4 && missingCount / data.functions.length > 0.5;

  return (
    <AppShell editions={data.editions} mode={data.mode} failedStage={data.partial?.failed_stage}>
      <div className="flex flex-col gap-5">
        {suspiciousMissing && (
          <Alert className="border-status-missing-fg/30 bg-status-missing-bg text-status-missing-fg">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Более половины функций без найденного соответствия</AlertTitle>
            <AlertDescription>
              Так бывает, когда загружены разные документы или текст прочитан не полностью. Проверьте, что в «До» и
              «После» — редакции одного положения, и посмотрите раздел «Ограничения» в заключении.
            </AlertDescription>
          </Alert>
        )}
        {data.mode === "partial" && data.partial && (
          <Alert className="border-status-missing-fg/30 bg-status-missing-bg text-status-missing-fg">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Частичный результат</AlertTitle>
            <AlertDescription>
              {data.partial.failed_stage ? `Стадия ${data.partial.failed_stage} не завершена: ` : ""}
              {data.partial.message}. Показано то, что удалось посчитать; подробности — в разделе «Ограничения» заключения.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Результаты сравнения</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.units.length} {plural(data.units.length, "подразделение", "подразделения", "подразделений")} ·{" "}
              {data.functions.length} {plural(data.functions.length, "функция", "функции", "функций")} · {data.risks.length}{" "}
              {plural(data.risks.length, "вопрос", "вопроса", "вопросов")} для проверки
              {missingCount > 0 && ` · ${missingCount} без найденного соответствия`}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <Link to={`/analyses/${encodeURIComponent(id ?? DEMO_ID)}/review`}>
                <ListChecks className="size-4" aria-hidden="true" />
                {openQuestions > 0 ? `Проверить выводы (${openQuestions})` : "Очередь проверки"}
              </Link>
            </Button>
            <ExportMenu result={data} />
          </div>
        </div>

        <Tabs defaultValue={findingId ? "functions" : "structure"} className="gap-4">
          <TabsList className="no-print w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="structure">Структура</TabsTrigger>
            <TabsTrigger value="functions">Функции и риски</TabsTrigger>
            <TabsTrigger value="conclusion">Заключение</TabsTrigger>
          </TabsList>

          <TabsContent value="structure" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {(Object.keys(UNIT_STATUS) as UnitStatus[])
                .filter((s) => unitCounts[s])
                .map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <StatusChip status={s} kind="unit" />
                    <span className="tabular-nums text-muted-foreground">{unitCounts[s]}</span>
                  </span>
                ))}
            </div>
            <UnitTable units={data.units} onEvidence={setEvidence} />
          </TabsContent>

          <TabsContent value="functions" className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Карта функций</h2>
              <FunctionMapTable functions={data.functions} onEvidence={setEvidence} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Вопросы для проверки</h2>
              {data.risks.length === 0 ? (
                <p className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  {riskSummary(data)}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.risks.map((r) => (
                    <RiskCard key={r.id} risk={r} onEvidence={setEvidence} />
                  ))}
                  {data.coverage?.complete && !data.risks.some((r) => r.kind === "conflict") && (
                    <p className="text-xs text-muted-foreground">
                      Признаков конфликта интересов в предоставленном комплекте не выявлено.
                    </p>
                  )}
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="conclusion">
            <ConclusionReport result={data} onEvidence={setEvidence} />
          </TabsContent>
        </Tabs>

        <TracePanel trace={data.trace} />
      </div>

      <EvidenceDrawer
        request={evidence?.finding_id ? reviewQueue(data).find((f) => f.finding_id === evidence.finding_id) ?? evidence : evidence}
        analysisId={id ?? DEMO_ID}
        onClose={() => { setEvidence(null); const next = new URLSearchParams(params); next.delete("finding"); setParams(next, { replace: true }); }}
        onRetry={reload}
        onReview={onReview}
      />
    </AppShell>
  );
}
