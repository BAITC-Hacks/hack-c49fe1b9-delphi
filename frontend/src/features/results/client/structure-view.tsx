"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunDetail } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { structureLabel } from "../model/labels";

export function StructureView({
  run,
  onSource,
}: {
  run: RunDetail;
  onSource: (id: string) => void;
}) {
  const { t } = useI18n();
  const units = new Map(run.units.map((unit) => [unit.id, unit]));

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
      <p className="text-sm text-muted-foreground">
        {t(
          "Названия и пояснения структуры сохранены на языке исходного результата. Связи показываются только при наличии источников.",
          "Құрылым атаулары мен түсіндірмелері бастапқы нәтиже тілінде сақталған. Байланыстар тек дереккөз болғанда көрсетіледі.",
          "Structure names and explanations retain the saved result language. Mappings are shown only when supported by sources.",
        )}
      </p>
      {run.structure.length ? (
        <div className="overflow-x-auto rounded-lg border">
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
                  <TableCell className="max-w-60 whitespace-normal align-top">
                    {names(change.before_unit_ids)}
                  </TableCell>
                  <TableCell className="max-w-60 whitespace-normal align-top">
                    {names(change.after_unit_ids)}
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal align-top">
                    <Badge variant="outline" className="whitespace-normal">
                      {structureLabel(change.status, t)}
                    </Badge>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {change.explanation}
                    </p>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      {change.source_ids.map((id, index) => (
                        <Button
                          size="sm"
                          variant="outline"
                          key={id}
                          onClick={() => onSource(id)}
                        >
                          {t("Пункт", "Тармақ", "Source")} {index + 1}
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
      <details className="rounded-lg border p-4">
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
