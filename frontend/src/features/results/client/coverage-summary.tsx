"use client";

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
  return (
    <details
      className="rounded-lg border bg-card p-4"
      open={
        run.state === "partial" ||
        run.state === "failed" ||
        run.state === "interrupted"
      }
    >
      <summary className="cursor-pointer text-sm font-medium">
        {t(
          "Покрытие и ограничения",
          "Қамту және шектеулер",
          "Coverage and limitations",
        )}{" "}
        · {coverage.processed_sources}/{coverage.total_sources}{" "}
        {t("блоков", "блок", "blocks")}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
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
          <p className="font-medium">
            {t(
              "Входные документы прочитаны не полностью. Выводы ограничены доступными фрагментами.",
              "Кіріс құжаттар толық оқылмады. Қорытындылар қолжетімді үзінділермен шектеледі.",
              "The input is incomplete. Findings cover only the available material.",
            )}
          </p>
        ) : null}
        {warnings.map(([id, items]) => (
          <div key={id}>
            <p className="font-medium break-words">{labels.get(id) ?? id}</p>
            <ul className="list-inside list-disc text-muted-foreground">
              {items.map((item, index) => (
                <li className="break-words" key={`${item}-${index}`}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {run.errors.length ? (
          <ul role="alert" className="list-inside list-disc text-destructive">
            {run.errors.map((error, index) => (
              <li className="break-words" key={`${error}-${index}`}>
                {error}
              </li>
            ))}
          </ul>
        ) : null}
        {coverage.unprocessed_source_ids.length ? (
          <p>
            {t(
              "Непроверенные блоки",
              "Тексерілмеген блоктар",
              "Unprocessed blocks",
            )}
            : {coverage.unprocessed_source_ids.length}
          </p>
        ) : null}
        {coverage.unreviewed_function_ids.length ? (
          <p>
            {t(
              "Несопоставленные функции",
              "Салыстырылмаған функциялар",
              "Unreviewed functions",
            )}
            : {coverage.unreviewed_function_ids.length}
          </p>
        ) : null}
      </div>
    </details>
  );
}
