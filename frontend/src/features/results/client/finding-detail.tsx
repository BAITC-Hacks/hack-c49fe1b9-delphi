"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Copy, GitCompareArrows, SearchX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FindingStatusBadge } from "@/components/custom-ui/finding-status-badge";
import { Button } from "@/components/ui/button";
import type { DocumentResponse, FindingResponse, FunctionResponse, TranslatedFinding } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { resultsApi } from "../api/results-api";
import { comparisonPair, groupEvidence } from "../model/evidence";
import { reviewLabel } from "../model/labels";
import { EvidenceCard } from "./evidence-card";
import { RequestError } from "./request-error";
import { ReviewForm } from "./review-form";
import { WordDiff } from "./word-diff";

export function FindingDetail({
  finding, functions, translation, analysisId, documents = [], canReview = true,
  reviewDisabled = false, autoFocus = true, onSource, onClose, onReviewSaved,
}: {
  finding: FindingResponse;
  functions: FunctionResponse[];
  translation?: TranslatedFinding;
  analysisId: string;
  documents?: DocumentResponse[];
  canReview?: boolean;
  reviewDisabled?: boolean;
  autoFocus?: boolean;
  onSource: (id: string) => void;
  onClose: () => void;
  onReviewSaved?: (findingId: string) => void;
}) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) heading.current?.focus();
  }, [finding.id, autoFocus]);
  const evidence = useQuery({
    queryKey: ["evidence", finding.id],
    queryFn: () => resultsApi.evidence(finding.id),
  });
  const [diffPreference, setDiffPreference] = useState<{ id: string; visible: boolean } | null>(null);
  const showDiff = diffPreference?.id === finding.id ? diffPreference.visible
    : finding.change_type === "reworded" || finding.issue_type === "modality_changed" || finding.issue_type === "scope_changed";
  const text = translation ?? finding;
  const groups = groupEvidence(evidence.data ?? []);
  const pair = comparisonPair(finding, evidence.data ?? []);
  const matched = {
    before: functions.filter((item) => finding.before_function_ids.includes(item.id)),
    after: functions.filter((item) => finding.after_function_ids.includes(item.id)),
  };
  const owners = (side: "before" | "after") => [...new Set(matched[side].map((item) => item.actor_original))].join(", ");
  const bothAfter = (finding.issue_type === "overlap" || finding.issue_type === "potential_conflict") && groups.after.length > 1;

  async function copyLink() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("finding", finding.id);
      url.searchParams.set("tab", "functions");
      for (const key of ["source", "q", "change", "issue", "review", "unit"])
        url.searchParams.delete(key);
      await navigator.clipboard.writeText(url.href);
      toast.success(t("Ссылка скопирована", "Сілтеме көшірілді", "Link copied"));
    } catch {
      toast.error(t("Не удалось скопировать ссылку. Скопируйте адрес страницы.", "Сілтемені көшіру мүмкін болмады. Бет мекенжайын көшіріңіз.", "Could not copy the link. Copy the page address instead."));
    }
  }

  return (
    <section aria-label={t("Доказательства вывода", "Қорытынды дәлелдері", "Finding evidence")}
      className="@container min-w-0 space-y-5 rounded-xl border bg-card p-4 sm:p-5"
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FindingStatusBadge changeType={finding.change_type} issueType={finding.issue_type ?? undefined} />
          {finding.issue_type ? <FindingStatusBadge changeType={finding.change_type} /> : null}
          <FindingStatusBadge reviewStatus={finding.review.status} />
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { void copyLink(); }}><Copy className="size-3.5" aria-hidden="true" />{t("Ссылка", "Сілтеме", "Copy link")}</Button>
            <Button variant="ghost" size="icon" aria-label={t("Закрыть вывод", "Қорытындыны жабу", "Close finding")} onClick={onClose}><X className="size-4" aria-hidden="true" /></Button>
          </div>
        </div>
        <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold leading-snug break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{text.title}</h3>
        {matched.before.length || matched.after.length ? <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{bothAfter ? t("Исполнители «После»", "«Кейін» орындаушылары", "After owners") : t("Исполнитель", "Орындаушы", "Owner")}:</span>
          {!bothAfter ? <><span>{owners("before") || "—"}</span><ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></> : null}
          <span>{owners("after") || t("Не установлен в «После»", "«Кейін» анықталмаған", "Not established in After")}</span>
        </p> : null}
      </header>
      <div className="grid gap-4 @xl:grid-cols-2">
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Что изменилось", "Не өзгерді", "What changed")}</h4>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text.explanation}</p>
        </div>
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Что проверить", "Нені тексеру керек", "What to check")}</h4>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text.recommendation}</p>
        </div>
      </div>
      {evidence.isPending ? <p role="status" className="text-sm text-muted-foreground">{t("Загрузка доказательств…", "Дәлелдер жүктелуде…", "Loading evidence…")}</p> : null}
      {evidence.isError ? <RequestError error={evidence.error} retry={() => { void evidence.refetch(); }} /> : null}
      {evidence.data ? <>
        <div className="grid gap-4 @xl:grid-cols-2">
          {(["before", "after"] as const).map((side) => <section key={side} className="min-w-0 space-y-3" aria-label={side === "before" ? t("Цитаты «До»", "«Дейін» дәйексөздері", "Before quotations") : t("Цитаты «После»", "«Кейін» дәйексөздері", "After quotations")}>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{side === "before" ? t("«До»", "«Дейін»", "Before") : t("«После»", "«Кейін»", "After")} · {groups[side].length}</h4>
            {groups[side].length ? groups[side].map((item, index) => <EvidenceCard key={`${finding.id}:${item.source_id}:${index}`} item={item} analysisId={analysisId} document={documents.find((doc) => doc.id === item.document_id)} onSource={onSource} />) : <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 p-5 text-center text-sm">
              <SearchX className="size-5 text-muted-foreground" aria-hidden="true" />
              <p>{side === "before" && bothAfter ? t("Оба пункта — в комплекте «После»", "Екі тармақ та «Кейін» жиынтығында", "Both supporting clauses are in the After set") : side === "after" ? t("Подтверждённое соответствие в «После» не указано", "«Кейін» расталған сәйкестік көрсетілмеген", "No confirmed After counterpart is recorded") : t("Подтверждённый пункт «До» не указан", "Расталған «Дейін» тармағы көрсетілмеген", "No confirmed Before clause is recorded")}</p>
              {!bothAfter ? <p className="text-xs text-muted-foreground">{t("Это не доказывает отсутствие самой обязанности. Проверьте полноту поиска и документов.", "Бұл міндеттің жоқтығын дәлелдемейді. Іздеу мен құжаттардың толықтығын тексеріңіз.", "This does not establish that the duty is absent. Check search coverage and document completeness.")}</p> : null}
            </div>}
            {matched[side].length ? <details className="rounded-lg bg-muted/30 p-3 text-xs">
              <summary className="cursor-pointer font-medium">{t("Область ответственности и условия", "Жауапкершілік аясы мен шарттары", "Responsibility scope and conditions")}</summary>
              <div className="mt-3 space-y-3">{matched[side].map((item) => <div key={item.id} className="space-y-1 break-words">
                <p className="font-medium">{item.actor_original}: {item.action} {item.object}</p>
                <p>{t("Область", "Қолданылу аясы", "Scope")}: {item.scope || "—"}</p>
                <p>{t("Условие", "Шарт", "Condition")}: {item.condition || "—"}</p>
                <p>{t("Обязательность", "Міндеттілік", "Modality")}: {item.modality || "—"}</p>
              </div>)}</div>
            </details> : null}
          </section>)}
        </div>
        {groups.context.length ? <section className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Дополнительный контекст", "Қосымша контекст", "Additional context")}</h4>
          <div className="grid gap-3 @xl:grid-cols-2">{groups.context.map((item, index) => <EvidenceCard key={`context:${finding.id}:${item.source_id}:${index}`} item={item} analysisId={analysisId} document={documents.find((doc) => doc.id === item.document_id)} onSource={onSource} />)}</div>
        </section> : null}
        {pair ? <div className="space-y-3">
          <Button variant="outline" size="sm" aria-pressed={showDiff} onClick={() => setDiffPreference({ id: finding.id, visible: !showDiff })}><GitCompareArrows className="size-4" aria-hidden="true" />{showDiff ? t("Скрыть различия слов", "Сөз айырмашылықтарын жасыру", "Hide word differences") : t("Показать различия слов", "Сөз айырмашылықтарын көрсету", "Show word differences")}</Button>
          {showDiff ? <WordDiff before={pair.before.original_text} after={pair.after.original_text} /> : null}
        </div> : null}
        <p className="text-xs text-muted-foreground">{t("Цитаты приведены дословно. Подсветка отмечает доказательство; зачёркивание и подчёркивание — различия текста.", "Дәйексөздер сөзбе-сөз берілген. Ерекшелеу дәлелді, сызу мен астын сызу мәтін айырмашылығын көрсетеді.", "Quotations remain verbatim. Highlighting marks evidence; strike-through and underlining mark text differences.")}</p>
      </> : null}
      {finding.search ? (
        <details
          open={!finding.search.complete}
          className="rounded-md border p-3 text-sm"
        >
          <summary className="cursor-pointer font-medium">
            {finding.search.method === "semantic_all_before_batches"
              ? t(
                  "Проверка комплекта «До»",
                  "«Дейін» жиынтығын тексеру",
                  "Before-set search",
                )
              : t(
                  "Проверка комплекта «После»",
                  "«Кейін» жиынтығын тексеру",
                  "After-set search",
                )}{" "}
            ·{" "}
            {finding.search.complete
              ? t("поиск завершён", "іздеу аяқталды", "search completed")
              : t("есть ограничения", "шектеулер бар", "limited search")}
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              {t("Просмотрено блоков", "Қаралған блоктар", "Reviewed blocks")}:{" "}
              {finding.search.reviewed_source_ids.length}
            </p>
            {finding.search.input_partial ? (
              <p>
                {t(
                  "Исходный комплект неполный.",
                  "Бастапқы жиынтық толық емес.",
                  "The input set is incomplete.",
                )}
              </p>
            ) : null}
            <p>
              {t(
                "Найдено кандидатов",
                "Табылған үміткерлер",
                "Candidates found",
              )}
              : {finding.search.candidate_source_ids.length}
            </p>
            <div className="flex flex-wrap gap-1">
              {finding.search.candidate_source_ids.map((id, index) => (
                <Button
                  variant="outline"
                  size="sm"
                  key={id}
                  onClick={() => onSource(id)}
                >
                  {t("Кандидат", "Үміткер", "Candidate")} {index + 1}
                </Button>
              ))}
            </div>
            {finding.search.errors.map((error, index) => (
              <p
                className="break-words text-destructive"
                key={`${error}-${index}`}
              >
                {error}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      {canReview ? (
        <ReviewForm key={`${finding.id}-${finding.review.updated_at}`} finding={finding} analysisId={analysisId} disabled={reviewDisabled} onReviewSaved={onReviewSaved} />
      ) : (
        <div className="space-y-2 border-t pt-4 text-sm">
          <p className="font-medium">{t("Проверка человеком", "Адамның тексеруі", "Human review")}: {reviewLabel(finding.review.status, t)}</p>
          {finding.review.note ? <p className="whitespace-pre-wrap break-words">{finding.review.note}</p> : null}
          <p className="text-muted-foreground">{t("Сохранённые доказательства доступны для чтения. Проверка станет доступна после завершения обработки.", "Сақталған дәлелдерді оқуға болады. Тексеру өңдеу аяқталған соң қолжетімді болады.", "Saved evidence is available to read. Review becomes available when processing finishes.")}</p>
        </div>
      )}
    </section>
  );
}
