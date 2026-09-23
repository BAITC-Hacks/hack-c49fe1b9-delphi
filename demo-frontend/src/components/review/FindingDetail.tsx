import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, GitCompareArrows, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClauseFragment } from "@/components/ClauseFragment";
import { EmptyState } from "@/components/EmptyState";
import { ReviewChip } from "@/components/ReviewControls";
import { StatusChip } from "@/components/StatusChip";
import { WordDiff } from "@/components/review/WordDiff";
import type { QueueItem } from "@/hooks/useReviewQueue";
import type { ClauseRef } from "@/types";

function Quotes({ label, refs, analysisId, empty }: { label: "До" | "После"; refs: ClauseRef[]; analysisId: string; empty: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={`Цитаты из комплекта «${label}»`}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">«{label}»</h3>
      {refs.length === 0 ? (
        <EmptyState icon={SearchX} tone={label === "После" ? "amber" : "neutral"} title={empty} className="min-h-28" />
      ) : (
        refs.map((ref, i) => (
          <div key={`${ref.clause_id}:${i}`} className="rounded-lg border bg-card p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {ref.edition} · <span className="font-mono">п. {ref.clause_number}</span>
            </p>
            <ClauseFragment ref_={ref} analysisId={analysisId} />
          </div>
        ))
      )}
    </section>
  );
}

/** Right pane: what changed, who owned it before and after, and the verbatim clauses side by side. */
/** Word diff is on by default where the wording itself is the finding. */
const DIFF_BY_DEFAULT = new Set(["reworded", "modality", "scope"]);

export function FindingDetail({ item, analysisId }: { item: QueueItem; analysisId: string }) {
  const bothAfter = item.kind === "risk" && item.after.length > 1;
  const pair = item.before.length === 1 && item.after.length === 1 ? { before: item.before[0], after: item.after[0] } : null;
  const [showDiff, setShowDiff] = useState(DIFF_BY_DEFAULT.has(item.status));
  useEffect(() => setShowDiff(DIFF_BY_DEFAULT.has(item.status)), [item.id, item.status]);
  return (
    <article className="flex flex-col gap-5" aria-label={item.title}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={item.status} kind={item.kind} size="md" />
          {item.secondary && item.secondary !== item.status && <StatusChip status={item.secondary} />}
          <ReviewChip review={item.review} />
        </div>
        <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
        {(item.fromUnits.length > 0 || item.toUnits.length > 0) && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Исполнитель:</span>
            <span>{item.fromUnits.join(", ") || "—"}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className={item.toUnits.length ? "" : "text-status-missing-fg"}>
              {item.toUnits.join(", ") || "соответствие в «После» не найдено"}
            </span>
          </p>
        )}
      </header>

      {(item.explanation || item.recommendation) && (
        <div className="grid gap-3 md:grid-cols-2">
          {item.explanation && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Что изменилось</p>
              <p className="mt-1 text-sm leading-relaxed">{item.explanation}</p>
            </div>
          )}
          {item.recommendation && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Что проверить</p>
              <p className="mt-1 text-sm leading-relaxed">{item.recommendation}</p>
            </div>
          )}
        </div>
      )}

      {item.evidenceError && (
        <p className="flex items-start gap-2 rounded-md border border-status-missing-fg/30 bg-status-missing-bg px-3 py-2 text-sm text-status-missing-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Доказательства загружены не полностью: {item.evidenceError}. Проверьте пункты вручную.
        </p>
      )}

      {item.search && (
        <p
          className={
            item.searchIncomplete
              ? "rounded-md border border-status-missing-fg/30 bg-status-missing-bg px-3 py-2 text-sm text-status-missing-fg"
              : "rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          }
        >
          {item.search}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Quotes
          label="До"
          refs={item.before}
          analysisId={analysisId}
          empty={bothAfter ? "Оба пункта — в комплекте «После»" : item.status === "new" ? "Функции не было в «До»" : "Нет пункта «До»"}
        />
        <Quotes label="После" refs={item.after} analysisId={analysisId} empty="Соответствие в комплекте «После» не найдено" />
      </div>
      {item.context.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Дополнительный контекст">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Дополнительный контекст</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {item.context.map((ref, i) => (
              <div key={`${ref.clause_id}:${i}`} className="rounded-lg border border-dashed bg-card p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {ref.edition} · <span className="font-mono">п. {ref.clause_number}</span>
                </p>
                <ClauseFragment ref_={ref} analysisId={analysisId} />
              </div>
            ))}
          </div>
        </section>
      )}
      {pair && (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            variant="outline"
            className="w-fit gap-1.5"
            aria-pressed={showDiff}
            onClick={() => setShowDiff((v) => !v)}
          >
            <GitCompareArrows className="size-4" aria-hidden="true" />
            {showDiff ? "Скрыть различия слов" : "Показать различия слов"}
          </Button>
          {showDiff && <WordDiff before={pair.before} after={pair.after} analysisId={analysisId} />}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Цитаты приводятся дословно по исходным документам.</p>
    </article>
  );
}
