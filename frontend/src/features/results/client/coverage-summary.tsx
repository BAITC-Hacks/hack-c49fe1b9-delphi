"use client";

import { ChevronDown, ScanText, TriangleAlert } from "lucide-react";
import type { DocumentResponse, RunDetail } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";

export function CoverageSummary({
  run,
  documents,
}: {
  run: RunDetail;
  documents: DocumentResponse[];
}) {
  const { t } = useI18n();
  const coverage = run.coverage;
  const warnings = Object.entries(coverage.input_warnings);
  const labels = new Map(
    documents.map((document) => [document.id, document.filename]),
  );
  const limited =
    coverage.input_partial ||
    warnings.some(([, items]) => items.length > 0) ||
    run.errors.length > 0 ||
    coverage.unprocessed_source_ids.length > 0 ||
    coverage.unreviewed_function_ids.length > 0 ||
    (coverage.unclassified_after_function_ids?.length ?? 0) > 0 ||
    ["partial", "failed", "interrupted"].includes(run.state);

  return (
    <details
      className={`group rounded-xl border bg-card shadow-sm ${limited ? "border-status-missing-fg/30" : ""}`}
      open={
        run.state === "partial" ||
        run.state === "failed" ||
        run.state === "interrupted"
      }
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3.5 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <ScanText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-medium">
            {t(
              "Покрытие и ограничения",
              "Қамту және шектеулер",
              "Coverage and limitations",
            )}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {coverage.processed_sources}/{coverage.total_sources}{" "}
            {t("блоков", "блок", "blocks")}
          </span>
          {limited ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-status-missing-bg px-2 py-1 text-xs font-medium text-status-missing-fg">
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              {t("Есть ограничения", "Шектеулер бар", "Limitations reported")}
            </span>
          ) : null}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-4 border-t px-4 py-4 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5 [&>div]:flex [&>div]:min-w-0 [&>div]:flex-col [&>div]:justify-between [&>div]:gap-3 [&>div]:rounded-lg [&>div]:border [&>div]:bg-muted/25 [&>div]:p-3 [&_dd]:text-lg [&_dd]:font-semibold [&_dd]:tracking-tight [&_dd]:tabular-nums [&_dt]:text-xs [&_dt]:leading-relaxed">
          <div>
            <dt className="text-muted-foreground">
              {t(
                "Установлено происхождение функций «После»",
                "«Кейін» функцияларының шығу тегі анықталды",
                "After function provenance checked",
              )}
            </dt>
            <dd>
              {coverage.classified_after_functions ?? 0}/{coverage.after_functions}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("Документы", "Құжаттар", "Documents")}
            </dt>
            <dd>{coverage.total_documents}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t(
                "Сопоставлено функций «До»",
                "«Дейін» салыстырылған функциялар",
                "Before functions compared",
              )}
            </dt>
            <dd>
              {coverage.compared_before_functions}/{coverage.before_functions}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t(
                "Проверено функций «После»",
                "«Кейін» тексерілген функциялар",
                "After functions reviewed",
              )}
            </dt>
            <dd>
              {coverage.reviewed_after_functions}/{coverage.after_functions}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t(
                "Проверено подразделений",
                "Тексерілген бөлімшелер",
                "Structure units reviewed",
              )}
            </dt>
            <dd>
              {coverage.reviewed_structure_units}/{coverage.structure_units}
            </dd>
          </div>
        </dl>
        {coverage.input_partial ? (
          <p className="rounded-lg border border-status-missing-fg/20 bg-status-missing-bg p-3 font-medium leading-relaxed text-status-missing-fg">
            {t(
              "Входные документы прочитаны не полностью. Выводы ограничены доступными фрагментами.",
              "Кіріс құжаттар толық оқылмады. Қорытындылар қолжетімді үзінділермен шектеледі.",
              "The input is incomplete. Findings cover only the available material.",
            )}
          </p>
        ) : null}
        {warnings.map(([id, items]) => (
          <div className="space-y-2 rounded-lg border border-status-missing-fg/20 bg-status-missing-bg/40 p-3" key={id}>
            <p className="font-medium break-words text-status-missing-fg [overflow-wrap:anywhere]">{labels.get(id) ?? id}</p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {items.map((item, index) => (
                <li className="break-words leading-relaxed [overflow-wrap:anywhere]" key={`${item}-${index}`}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {run.errors.length ? (
          <ul role="alert" className="list-disc space-y-1 rounded-lg border border-destructive/20 bg-destructive/5 py-3 pr-3 pl-7 text-destructive">
            {run.errors.map((error, index) => (
              <li className="break-words leading-relaxed [overflow-wrap:anywhere]" key={`${error}-${index}`}>
                {error}
              </li>
            ))}
          </ul>
        ) : null}
        {coverage.unprocessed_source_ids.length ? (
          <p className="flex items-baseline justify-between gap-3 border-b pb-2 text-muted-foreground">
            <span>
              {t(
                "Непроверенные блоки",
                "Тексерілмеген блоктар",
                "Unprocessed blocks",
              )}
            </span>
            <span className="shrink-0 font-semibold text-status-missing-fg tabular-nums">
              {coverage.unprocessed_source_ids.length}
            </span>
          </p>
        ) : null}
        {coverage.unreviewed_function_ids.length ? (
          <p className="flex items-baseline justify-between gap-3 border-b pb-2 text-muted-foreground">
            <span>
              {t(
                "Несопоставленные функции",
                "Салыстырылмаған функциялар",
                "Unreviewed functions",
              )}
            </span>
            <span className="shrink-0 font-semibold text-status-missing-fg tabular-nums">
              {coverage.unreviewed_function_ids.length}
            </span>
          </p>
        ) : null}
        {coverage.unclassified_after_function_ids?.length ? (
          <p className="flex items-baseline justify-between gap-3 border-b pb-2 text-muted-foreground">
            <span>
              {t(
                "Функции «После» с незавершённой проверкой происхождения",
                "Шығу тегі толық тексерілмеген «Кейін» функциялары",
                "After functions awaiting provenance checks",
              )}
            </span>
            <span className="shrink-0 font-semibold text-status-missing-fg tabular-nums">
              {coverage.unclassified_after_function_ids.length}
            </span>
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Счётчики показывают объём обработки, а не точность выводов. Возможные пробелы и новые обязанности требуют проверки исходного комплекта.",
            "Санауыштар қорытындылардың дәлдігін емес, өңдеу көлемін көрсетеді. Ықтимал олқылықтар мен жаңа міндеттер бастапқы жиынтықты тексеруді қажет етеді.",
            "Counts show processing coverage, not finding accuracy. Potential gaps and new duties require checking the original document set.",
          )}
        </p>
      </div>
    </details>
  );
}
