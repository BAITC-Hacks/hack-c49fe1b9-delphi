"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  FindingResponse,
  FunctionResponse,
  TranslatedFinding,
} from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { resultsApi } from "../api/results-api";
import { changeLabel, issueLabel } from "../model/labels";
import { RequestError } from "./request-error";
import { ReviewForm } from "./review-form";

export function FindingDetail({
  finding,
  functions,
  translation,
  analysisId,
  onSource,
  onClose,
}: {
  finding: FindingResponse;
  functions: FunctionResponse[];
  translation?: TranslatedFinding;
  analysisId: string;
  onSource: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [finding.id]);
  const evidence = useQuery({
    queryKey: ["evidence", finding.id],
    queryFn: () => resultsApi.evidence(finding.id),
  });
  const text = translation ?? finding;

  async function copyLink() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("finding", finding.id);
      url.searchParams.set("tab", "functions");
      url.searchParams.delete("source");
      await navigator.clipboard.writeText(url.href);
      toast.success(
        t("Ссылка скопирована", "Сілтеме көшірілді", "Link copied"),
      );
    } catch {
      toast.error(
        t(
          "Не удалось скопировать ссылку. Скопируйте адрес страницы.",
          "Сілтемені көшіру мүмкін болмады. Бет мекенжайын көшіріңіз.",
          "Could not copy the link. Copy the page address instead.",
        ),
      );
    }
  }

  return (
    <section
      aria-label={t(
        "Доказательства вывода",
        "Қорытынды дәлелдері",
        "Finding evidence",
      )}
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          ref={heading}
          tabIndex={-1}
          className="font-semibold break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {text.title}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Закрыть вывод", "Қорытындыны жабу", "Close finding")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{changeLabel(finding.change_type, t)}</Badge>
        {finding.issue_type ? (
          <Badge variant="secondary">{issueLabel(finding.issue_type, t)}</Badge>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void copyLink();
          }}
        >
          <Copy className="size-3.5" />
          {t("Ссылка", "Сілтеме", "Copy link")}
        </Button>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">
        {text.explanation}
      </p>
      <div className="rounded-md bg-muted p-3 text-sm">
        <p className="mb-1 font-medium">
          {t("Рекомендация", "Ұсыным", "Recommendation")}
        </p>
        <p className="whitespace-pre-wrap break-words">{text.recommendation}</p>
      </div>
      {evidence.isPending ? (
        <p role="status" className="text-sm">
          {t(
            "Загрузка доказательств…",
            "Дәлелдер жүктелуде…",
            "Loading evidence…",
          )}
        </p>
      ) : null}
      {evidence.isError ? (
        <RequestError
          error={evidence.error}
          retry={() => {
            void evidence.refetch();
          }}
        />
      ) : null}
      {evidence.data ? (
        <div className="space-y-4">
          {(["before", "after"] as const).map((side) => {
            const items = evidence.data.filter((item) => item.side === side);
            const functionIds =
              side === "before"
                ? finding.before_function_ids
                : finding.after_function_ids;
            const matched = functions.filter((item) =>
              functionIds.includes(item.id),
            );
            return (
              <div className="space-y-3" key={side}>
                <h4 className="border-b pb-1 text-sm font-semibold">
                  {side === "before"
                    ? t("До", "Дейін", "Before")
                    : t("После", "Кейін", "After")}
                </h4>
                {matched.map((item) => (
                  <details
                    className="rounded-md border p-2 text-sm"
                    key={item.id}
                  >
                    <summary className="cursor-pointer break-words">
                      {item.actor_original}: {item.action} {item.object}
                    </summary>
                    <dl className="mt-2 space-y-1 text-muted-foreground">
                      <div>
                        <dt className="inline font-medium">
                          {t("Область", "Қолданылу аясы", "Scope")}:{" "}
                        </dt>
                        <dd className="inline whitespace-pre-wrap">
                          {item.scope || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">
                          {t("Условие", "Шарт", "Condition")}:{" "}
                        </dt>
                        <dd className="inline whitespace-pre-wrap">
                          {item.condition || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">
                          {t("Обязательность", "Міндеттілік", "Modality")}:{" "}
                        </dt>
                        <dd className="inline whitespace-pre-wrap">
                          {item.modality || "—"}
                        </dd>
                      </div>
                    </dl>
                  </details>
                ))}
                {items.length ? (
                  items.map((item, index) => (
                    <article
                      className="space-y-2 rounded-md border p-3"
                      key={`${item.source_id}-${index}`}
                    >
                      <p className="break-words text-xs font-medium">
                        {item.filename}
                        {item.clause_no
                          ? ` · ${t("п.", "т.", "clause")} ${item.clause_no}`
                          : ""}
                        {item.evidence_role === "context"
                          ? ` · ${t("Контекст", "Контекст", "Context")}`
                          : ""}
                      </p>
                      <blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary pl-3 text-sm leading-relaxed">
                        {item.excerpt}
                      </blockquote>
                      {item.excerpt !== item.original_text ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted-foreground">
                            {t(
                              "Полный исходный фрагмент",
                              "Толық бастапқы үзінді",
                              "Full original block",
                            )}
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap break-words">
                            {item.original_text}
                          </p>
                        </details>
                      ) : null}
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => onSource(item.source_id)}
                      >
                        {t(
                          "Открыть пункт и контекст",
                          "Тармақ пен контексті ашу",
                          "Open clause and context",
                        )}
                      </Button>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Источник на этой стороне не указан.",
                      "Бұл тарапта дереккөз көрсетілмеген.",
                      "No evidence is recorded on this side.",
                    )}
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {t(
              "Цитаты сохранены без перевода.",
              "Дәйексөздер аудармасыз сақталған.",
              "Quotations remain in their original language.",
            )}
          </p>
        </div>
      ) : null}
      {finding.search ? (
        <details
          open={!finding.search.complete}
          className="rounded-md border p-3 text-sm"
        >
          <summary className="cursor-pointer font-medium">
            {t(
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
      <ReviewForm
        key={`${finding.id}-${finding.review.updated_at}`}
        finding={finding}
        analysisId={analysisId}
      />
    </section>
  );
}
