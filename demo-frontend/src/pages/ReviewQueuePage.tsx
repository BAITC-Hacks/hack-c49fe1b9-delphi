import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, FileText } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AppShell } from "@/components/layout/AppShell";
import { DecisionBar } from "@/components/review/DecisionBar";
import { FindingDetail } from "@/components/review/FindingDetail";
import { QueueList } from "@/components/review/QueueList";
import { useAnalysis } from "@/hooks/useAnalysis";
import { buildQueue, useReviewQueue } from "@/hooks/useReviewQueue";
import { plural } from "@/lib/adapter";
import { DEMO_ID, saveReview } from "@/lib/api";
import { clearDemoReviews, isDemoId } from "@/lib/demo";
import { REVIEW_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ReviewStatus } from "@/types";

/**
 * Main working screen: question queue on the left, the change and verbatim quotes on the right,
 * the human decision at the bottom. After a decision the next question opens; filter and position stay.
 */
export default function ReviewQueuePage() {
  const { id = DEMO_ID } = useParams<{ id: string }>();
  const { data, error, loading, reload, replace } = useAnalysis(id);

  const items = useMemo(() => (data ? buildQueue(data) : []), [data]);
  const q = useReviewQueue(items);
  const liveResult = !!data?.live;
  const mobileDetail = q.detailOpen;
  const decisionBarRef = useRef<HTMLDivElement>(null);
  const [decisionBarHeight, setDecisionBarHeight] = useState(0);

  // Reserve the measured bar height so even the final quote stays readable on a phone.
  useEffect(() => {
    const bar = decisionBarRef.current;
    if (!bar) return;
    const measure = () => setDecisionBarHeight(bar.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [loading, mobileDetail, q.selected?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable))) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        q.step(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        q.step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q]);

  const decide = async (status: ReviewStatus, note: string) => {
    const item = q.selected;
    if (!item) return;
    const next = q.nextAfterDecision();
    try {
      // Live results go to the server; saved examples keep decisions in this browser (lib/demo.ts).
      const result = await saveReview(id, item.id, status, note);
      if (result) replace(result);
      toast.success(`${REVIEW_STATUS[status].label}: ${item.title}`);
      if (next && next !== item.id) q.select(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить решение");
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Не удалось загрузить выводы</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{error ?? "Пустой ответ сервера"}</span>
            <Button size="sm" variant="outline" onClick={reload}>
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  const done = q.questionsCount > 0 && q.reviewedCount === q.questionsCount;
  const percent = q.questionsCount ? Math.round((q.reviewedCount / q.questionsCount) * 100) : 100;

  return (
    <AppShell editions={data.editions} mode={data.mode} failedStage={data.partial?.failed_stage}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Проверка выводов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Проверено {q.reviewedCount} из {q.questionsCount}{" "}
              {plural(q.questionsCount, "вопроса", "вопросов", "вопросов")}. Решение человека не меняет исходный вывод и попадает в
              заключение.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isDemoId(id) && q.reviewedCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearDemoReviews(id);
                  void reload();
                }}
              >
                Сбросить решения примера
              </Button>
            )}
            <Button asChild size="sm" variant={done ? "default" : "outline"} className="gap-1.5">
              <Link to={`/analyses/${encodeURIComponent(id)}`}>
                <FileText className="size-4" aria-hidden="true" />
                Результаты и заключение
              </Link>
            </Button>
          </div>
        </div>
        <Progress value={percent} aria-label={`Проверено ${percent} %`} />

        <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
          <aside
            className={cn("lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-hidden", mobileDetail && "hidden")}
            aria-label="Очередь"
          >
            <QueueList
              items={q.visible}
              selectedId={q.selected?.id}
              scope={q.scope}
              statuses={q.statuses}
              presentStatuses={q.presentStatuses}
              quietCount={q.quietCount}
              withQuiet={q.withQuiet}
              coverageComplete={data.coverage?.complete === true}
              onSelect={q.select}
              onScope={q.setScope}
              onToggleStatus={q.toggleStatus}
              onWithQuiet={q.setWithQuiet}
              onReset={q.resetFilters}
            />
          </aside>

          <section className={cn("min-w-0 lg:block", !mobileDetail && "hidden")} aria-live="polite">
            {q.selected ? (
              <div className="flex flex-col rounded-lg border bg-background">
                <div className="flex flex-col gap-4 p-4 md:p-5">
                  <Button variant="ghost" size="sm" className="-ml-2 w-fit gap-1 lg:hidden" onClick={q.closeDetail}>
                    <ArrowLeft className="size-4" aria-hidden="true" />К очереди
                  </Button>
                  <FindingDetail item={q.selected} analysisId={id} />
                </div>
                <div className="lg:hidden" style={{ height: decisionBarHeight }} aria-hidden="true" />
                <div
                  ref={decisionBarRef}
                  className="fixed inset-x-0 bottom-0 z-30 bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(0_0_0/0.08)] lg:sticky lg:inset-x-auto lg:z-10 lg:rounded-b-lg lg:pb-0 lg:shadow-none"
                >
                  <DecisionBar itemId={q.selected.id} review={q.selected.review} localOnly={!liveResult} onDecide={decide} />
                </div>
              </div>
            ) : (
              <p className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
                {done ? "Все вопросы проверены. Заключение уже учитывает решения." : "Выберите вопрос слева."}
              </p>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
