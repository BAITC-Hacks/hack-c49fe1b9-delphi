"use client";

import { ArrowLeft, ArrowRight, CheckCheck, ListFilter } from "lucide-react";
import { FindingStatusBadge } from "@/components/custom-ui/finding-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  DocumentResponse,
  FindingResponse,
  FunctionResponse,
  RunDetail,
  SourceResponse,
  TranslatedFinding,
} from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { filterFindings, findingOwners, nextUnreviewedFinding, prioritizeFindings } from "../model/finding-queue";
import { reviewLabel, reviewStatuses } from "../model/labels";
import { FindingDetail } from "./finding-detail";
import { useResultsLocation } from "./use-results-location";

export function ReviewQueue({
  findings,
  functions,
  sources,
  run,
  analysisId,
  documents,
  translations,
  canReview,
  reviewDisabled,
  onSource,
}: {
  findings: FindingResponse[];
  functions: FunctionResponse[];
  sources: SourceResponse[];
  run: RunDetail;
  analysisId: string;
  documents: DocumentResponse[];
  translations: Map<string, TranslatedFinding>;
  canReview: boolean;
  reviewDisabled: boolean;
  onSource: (id: string) => void;
}) {
  const { t } = useI18n();
  const { params, update } = useResultsLocation();
  const review = params.get("review") ?? "all";
  const change = params.get("change") ?? "all";
  const issue = params.get("issue") ?? "all";
  const query = params.get("q") ?? "";
  const displayed = findings.map((finding) => ({ ...finding, ...translations.get(finding.id) }));
  const matching = prioritizeFindings(filterFindings(displayed, functions, sources, {
    query,
    change,
    issue,
    unit: params.get("unit") ?? "all",
  }));
  const visible = matching.filter((finding) => review === "all" || finding.review.status === review);
  const requestedId = params.get("finding");
  // A linked finding remains authoritative even when current filters hide it.
  // Unknown IDs must never open another finding in its place.
  const selected = requestedId
    ? displayed.find((finding) => finding.id === requestedId)
    : visible[0];
  const original = selected && findings.find((finding) => finding.id === selected.id);
  const mobileDetail = Boolean(requestedId && selected?.id === requestedId);
  const index = selected ? visible.findIndex((finding) => finding.id === selected.id) : -1;
  const reviewed = findings.filter((finding) => finding.review.status !== "unreviewed").length;
  const percent = findings.length ? Math.round(reviewed / findings.length * 100) : 0;
  const changes = [...new Set(prioritizeFindings(findings).map((finding) => finding.change_type))];
  const issues = [...new Set(findings.flatMap((finding) => finding.issue_type ? [finding.issue_type] : []))];
  const coverageComplete = run.state === "completed" && !run.coverage.input_partial &&
    run.coverage.unprocessed_source_ids.length === 0 && run.coverage.unreviewed_function_ids.length === 0 &&
    (run.coverage.unclassified_after_function_ids?.length ?? 0) === 0;

  function select(id: string | null) {
    update({ finding: id, source: null });
  }

  function afterReview(id: string) {
    select(nextUnreviewedFinding(matching, id) ?? (review === "unreviewed" ? null : id));
  }

  return (
    <section className="space-y-4" aria-label={t("Очередь проверки", "Тексеру кезегі", "Review queue")}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="font-medium">
            {t("Проверено", "Тексерілді", "Reviewed")} {reviewed} / {findings.length}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Решения сохраняются отдельно от исходных выводов и входят в заключение.", "Шешімдер бастапқы қорытындылардан бөлек сақталып, есепке қосылады.", "Decisions are saved separately from original findings and included in the report.")}
          </p>
        </div>
        <Progress value={percent} className="h-2" aria-label={t("Ход проверки человеком", "Адамның тексеру барысы", "Human review progress")} />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <aside className={cn("min-w-0 space-y-3 lg:sticky lg:top-5", mobileDetail && "hidden lg:block")}>
          <div className="flex flex-wrap gap-1" aria-label={t("Решения проверки", "Тексеру шешімдері", "Review decisions")}>
            {[...reviewStatuses, "all"].map((status) => (
              <Button
                key={status}
                size="sm"
                variant={review === status ? "default" : "outline"}
                className="h-auto rounded-full px-2.5 py-1 text-xs whitespace-normal"
                aria-pressed={review === status}
                onClick={() => update({ review: status, finding: null })}
              >
                {status === "all" ? t("Все", "Барлығы", "All") : reviewLabel(status as FindingResponse["review"]["status"], t)}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label={t("Тип изменения", "Өзгеріс түрі", "Change type")}>
            <ListFilter className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {changes.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={change === type}
                onClick={() => update({ change: change === type ? null : type, finding: null })}
                className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", change !== "all" && change !== type && "opacity-50")}
              >
                <FindingStatusBadge changeType={type} />
              </button>
            ))}
            {issues.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={issue === type}
                onClick={() => update({ issue: issue === type ? null : type, finding: null })}
                className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", issue !== "all" && issue !== type && "opacity-50")}
              >
                <FindingStatusBadge issueType={type} />
              </button>
            ))}
          </div>
          <Input
            value={query}
            onChange={(event) => update({ q: event.target.value, finding: null })}
            aria-label={t("Поиск в очереди", "Кезектен іздеу", "Search review queue")}
            placeholder={t("Функция, исполнитель, пункт…", "Функция, орындаушы, тармақ…", "Function, owner, clause…")}
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>{visible.length} {t("выводов · важные сначала", "қорытынды · маңыздысы алдымен", "findings · priority first")}</p>
            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => update({ q: null, change: null, issue: null, review: null, unit: null, finding: null })}>
              {t("Показать все", "Барлығын көрсету", "Show all")}
            </Button>
          </div>
          {visible.length ? (
            <ul className="space-y-1.5 lg:max-h-[calc(100dvh-22rem)] lg:overflow-y-auto lg:pr-1">
              {visible.map((finding) => (
                <li key={finding.id}>
                  <button
                    type="button"
                    aria-current={finding.id === selected?.id ? "true" : undefined}
                    onClick={() => select(finding.id)}
                    className={cn(
                      "flex w-full flex-col gap-2 rounded-lg border bg-card px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      finding.id === selected?.id ? "border-primary ring-1 ring-primary" : "hover:bg-muted/60",
                      finding.review.status === "rejected" && "opacity-65",
                    )}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      <FindingStatusBadge changeType={finding.change_type} issueType={finding.issue_type ?? undefined} />
                      {finding.review.status !== "unreviewed" ? <FindingStatusBadge reviewStatus={finding.review.status} /> : null}
                    </div>
                    <p className="text-sm leading-snug font-medium break-words">{finding.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {findingOwners(finding.before_function_ids, functions, run.units)} → {findingOwners(finding.after_function_ids, functions, run.units)}
                    </p>
                    {finding.change_type === "potentially_missing" && (!finding.search?.complete || finding.search.input_partial) ? (
                      <p className="text-xs font-medium text-status-missing-fg">{t("Полнота поиска не подтверждена", "Іздеудің толықтығы расталмады", "Search completeness is not confirmed")}</p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3 rounded-lg border bg-card p-5 text-sm">
              <CheckCheck className="size-5 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">{t("Нет выводов по выбранным фильтрам", "Таңдалған сүзгілер бойынша қорытынды жоқ", "No findings match these filters")}</p>
              <p className="text-muted-foreground">
                {coverageComplete
                  ? t("Сохранённые решения учтены в заключении. Можно показать все выводы.", "Сақталған шешімдер есепке қосылды. Барлық қорытындыны көрсетуге болады.", "Saved decisions are reflected in the report. You can show all findings.")
                  : t("Пустая очередь не подтверждает полноту анализа. Проверьте покрытие и ограничения.", "Бос кезек талдаудың толықтығын растамайды. Қамту мен шектеулерді тексеріңіз.", "An empty queue does not establish complete analysis. Check coverage and limitations.")}
              </p>
            </div>
          )}
        </aside>
        <div className={cn("min-w-0 space-y-3", !mobileDetail && "hidden lg:block")}>
          {original ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => select(null)}>
                  <ArrowLeft className="size-4" />{t("К очереди", "Кезекке", "Back to queue")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {index >= 0
                    ? `${index + 1} / ${visible.length}`
                    : t("Вывод вне выбранных фильтров", "Қорытынды таңдалған сүзгілерден тыс", "This finding is outside the current filters")}
                </span>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" disabled={index <= 0 || reviewDisabled} onClick={() => select(visible[index - 1].id)} aria-label={t("Предыдущий вывод", "Алдыңғы қорытынды", "Previous finding")}><ArrowLeft className="size-4" /></Button>
                  <Button size="sm" variant="outline" disabled={index < 0 || index >= visible.length - 1 || reviewDisabled} onClick={() => select(visible[index + 1].id)}>
                    {t("Следующий", "Келесі", "Next")}<ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
              <FindingDetail
                key={original.id}
                finding={original}
                autoFocus={mobileDetail}
                functions={functions}
                translation={translations.get(original.id)}
                analysisId={analysisId}
                documents={documents}
                canReview={canReview}
                reviewDisabled={reviewDisabled}
                onReviewSaved={afterReview}
                onSource={(id) => {
                  update({ finding: original.id });
                  onSource(id);
                }}
                onClose={() => select(null)}
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
