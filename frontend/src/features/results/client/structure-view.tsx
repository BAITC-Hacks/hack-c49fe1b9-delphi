"use client";

import { FileText } from "lucide-react";
import { FindingStatusBadge } from "@/components/custom-ui/finding-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DocumentResponse, RunDetail, SourceResponse, TranslationResponse } from "@/shared/api/generated";
import { sourceLocation } from "@/shared/documents/source-location";
import { useI18n } from "@/shared/i18n";

export function StructureView({
  run,
  translation,
  documents,
  sources,
  onSource,
}: {
  run: RunDetail;
  translation?: TranslationResponse["payload"]["structure"];
  documents: DocumentResponse[];
  sources: SourceResponse[];
  onSource: (id: string) => void;
}) {
  const { t } = useI18n();
  const units = new Map(run.units.map((unit) => [unit.id, unit]));
  const explanations = new Map(
    (translation ?? []).map((item) => [item.id, item.explanation]),
  );
  const statuses = [...new Set(run.structure.map((item) => item.status))];
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const documentMap = new Map(documents.map((document) => [document.id, document]));

  function sourceLabel(id: string, index: number) {
    const source = sourceMap.get(id);
    const document = source && documentMap.get(source.document_id);
    if (!source || !document) return `${t("Источник", "Дереккөз", "Source")} ${index + 1}`;
    const side = document.side === "before" ? t("До", "Дейін", "Before") : t("После", "Кейін", "After");
    return `${side} · ${document.revision_label || document.filename} · ${source.clause_no || sourceLocation(source.locator, t)}`;
  }

  function names(ids: string[]) {
    return ids.length
      ? ids
          .map(
            (id) =>
              units.get(id)?.name_original ??
              t(
                "Неизвестное подразделение",
                "Белгісіз бөлімше",
                "Unknown unit",
              ),
          )
          .join(" / ")
      : "—";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {statuses.map((status) => (
          <span className="inline-flex items-center gap-1.5 text-sm" key={status}>
            <FindingStatusBadge structureStatus={status} />
            <span className="tabular-nums text-muted-foreground">{run.structure.filter((item) => item.status === status).length}</span>
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {explanations.size
          ? t(
              "Пояснения структуры переведены. Названия подразделений и исходные пункты сохранены в оригинале.",
              "Құрылым түсіндірмелері аударылды. Бөлімше атаулары мен бастапқы тармақтар түпнұсқада сақталды.",
              "Structure explanations are translated. Unit names and source clauses remain original.",
            )
          : t(
              "Названия и пояснения структуры сохранены на языке исходного результата. Связи показываются только при наличии источников.",
              "Құрылым атаулары мен түсіндірмелері бастапқы нәтиже тілінде сақталған. Байланыстар тек дереккөз болғанда көрсетіледі.",
              "Structure names and explanations retain the saved result language. Mappings are shown only when supported by sources.",
            )}
      </p>
      {run.structure.length ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("До", "Дейін", "Before")}</TableHead>
                <TableHead>{t("После", "Кейін", "After")}</TableHead>
                <TableHead>{t("Изменение", "Өзгеріс", "Change")}</TableHead>
                <TableHead>
                  {t("Источники", "Дереккөздер", "Sources")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.structure.map((change) => (
                <TableRow key={change.id}>
                  <TableCell className="max-w-60 py-3 font-medium whitespace-normal align-top">
                    {names(change.before_unit_ids)}
                  </TableCell>
                  <TableCell className="max-w-60 py-3 font-medium whitespace-normal align-top">
                    {names(change.after_unit_ids)}
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal align-top">
                    <FindingStatusBadge structureStatus={change.status} />
                    <p className="mt-2 text-sm text-muted-foreground">
                      {explanations.get(change.id) ?? change.explanation}
                    </p>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      {change.source_ids.map((id, index) => (
                        <Button
                          size="sm"
                          variant="outline"
                          key={id}
                          className="h-auto max-w-60 justify-start py-1.5 text-left font-mono text-xs whitespace-normal"
                          onClick={() => onSource(id)}
                        >
                          <FileText className="size-3 shrink-0" aria-hidden="true" />{sourceLabel(id, index)}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border p-5 text-sm text-muted-foreground">
          {t(
            "В сохранённом результате нет связей структуры. Это не доказывает отсутствие изменений.",
            "Сақталған нәтижеде құрылым байланыстары жоқ. Бұл өзгерістер жоқ дегенді білдірмейді.",
            "No structure mappings were saved. This does not establish that the structure is unchanged.",
          )}
        </p>
      )}
      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t(
            "Распознанные подразделения и роли",
            "Анықталған бөлімшелер мен рөлдер",
            "Extracted units and roles",
          )}{" "}
          ({run.units.length})
        </summary>
        <ul className="mt-3 divide-y">
          {run.units.map((unit) => (
            <li className="py-3 text-sm" key={unit.id}>
              <p className="font-medium">{unit.name_original}</p>
              <p className="text-muted-foreground">
                {unit.side === "before"
                  ? t("До", "Дейін", "Before")
                  : t("После", "Кейін", "After")}{" "}
                ·{" "}
                {unit.kind === "department"
                  ? t("Подразделение", "Бөлімше", "Department")
                  : unit.kind === "role"
                    ? t("Роль", "Рөл", "Role")
                    : t("Группа", "Топ", "Group")}
                {unit.parent_unit_id
                  ? ` · ${t("Подчинение", "Бағыныстылық", "Parent")}: ${names([unit.parent_unit_id])}`
                  : ""}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {unit.source_ids.map((id, index) => (
                  <Button
                    variant="link"
                    size="sm"
                    key={id}
                    onClick={() => onSource(id)}
                  >
                    {t("Источник", "Дереккөз", "Source")} {index + 1}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
