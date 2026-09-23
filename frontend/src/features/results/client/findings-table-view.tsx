"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { useCallback, useMemo } from "react";
import { FindingStatusBadge } from "@/components/custom-ui/finding-status-badge";
import { DataTable } from "@/components/data-table/data-table";
import { useDataTable } from "@/components/data-table/use-data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  FindingResponse,
  FunctionResponse,
  SourceResponse,
  UnitResponse,
} from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import {
  changeLabel,
  changeTypes,
  issueLabel,
  issueTypes,
  reviewLabel,
  reviewStatuses,
} from "../model/labels";
import { filterFindings, prioritizeFindings } from "../model/finding-queue";
import { useResultsLocation } from "./use-results-location";

export function FindingsTableView({
  findings,
  functions,
  units,
  sources,
  selectedId,
  onSelect,
}: {
  findings: FindingResponse[];
  functions: FunctionResponse[];
  units: UnitResponse[];
  sources: SourceResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const { params, update } = useResultsLocation();
  const query = params.get("q") ?? "";
  const change = params.get("change") ?? "all";
  const issue = params.get("issue") ?? "all";
  const review = params.get("review") ?? "all";
  const unit = params.get("unit") ?? "all";
  const functionMap = useMemo(
    () => new Map(functions.map((item) => [item.id, item])),
    [functions],
  );
  const unitMap = useMemo(
    () => new Map(units.map((item) => [item.id, item])),
    [units],
  );
  const sourceMap = useMemo(
    () => new Map(sources.map((item) => [item.id, item])),
    [sources],
  );

  const owners = useCallback(
    (ids: string[]) => {
      return (
        [
          ...new Set(
            ids.flatMap((id) => {
              const item = functionMap.get(id);
              if (!item) return [];
              return item.owner_unit_ids.length
                ? item.owner_unit_ids.map(
                    (owner) =>
                      unitMap.get(owner)?.name_original ?? item.actor_original,
                  )
                : [item.actor_original];
            }),
          ),
        ].join(" / ") || "—"
      );
    },
    [functionMap, unitMap],
  );

  const filtered = useMemo(
    () =>
      prioritizeFindings(filterFindings(findings, functions, sources, { query, change, issue, review, unit })),
    [findings, functions, sources, query, change, issue, review, unit],
  );

  const columns = useMemo<ColumnDef<FindingResponse, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: t("Изменение", "Өзгеріс", "Finding"),
        cell: ({ row }) => (
          <div className={`min-w-48 max-w-sm space-y-2 whitespace-normal ${row.original.review.status === "rejected" ? "opacity-65" : ""} ${selectedId === row.original.id ? "rounded-md bg-primary/5 p-2 ring-1 ring-primary/20" : ""}`}>
            <Button
              variant="link"
              className="h-auto max-w-full justify-start p-0 text-left whitespace-normal [overflow-wrap:anywhere]"
              onClick={() => onSelect(row.original.id)}
              aria-pressed={selectedId === row.original.id}
            >
              {row.original.title}
            </Button>
            <div className="flex flex-wrap gap-1">
              <FindingStatusBadge changeType={row.original.change_type} />
              {row.original.issue_type ? (
                <FindingStatusBadge issueType={row.original.issue_type} />
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {row.original.source_ids
                .map((id) => sourceMap.get(id)?.clause_no)
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ),
      },
      {
        id: "owners",
        header: t(
          "Исполнители: до → после",
          "Орындаушылар: дейін → кейін",
          "Owners: before → after",
        ),
        cell: ({ row }) => (
          <div className="max-w-56 whitespace-normal text-xs">
            <p>{owners(row.original.before_function_ids)}</p>
            <p className="my-1 text-muted-foreground" aria-hidden="true">
              ↓
            </p>
            <p>{owners(row.original.after_function_ids)}</p>
          </div>
        ),
      },
      {
        accessorKey: "review.status",
        header: t("Проверка", "Тексеру", "Review"),
        cell: ({ row }) => (
          <FindingStatusBadge reviewStatus={row.original.review.status} />
        ),
      },
    ],
    [onSelect, owners, selectedId, sourceMap, t],
  );
  const table = useDataTable({ columns, data: filtered });

  return (
    <div className="@container min-w-0 space-y-3">
      <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        className="pl-9"
        aria-label={t(
          "Поиск по функции и номеру пункта",
          "Функция және тармақ нөмірі бойынша іздеу",
          "Search function or clause number",
        )}
        placeholder={t(
          "Функция, исполнитель, пункт…",
          "Функция, орындаушы, тармақ…",
          "Function, owner, clause…",
        )}
        value={query}
        onChange={(event) => update({ q: event.target.value })}
      />
      </div>
      <div className="grid gap-2 @min-[28rem]:grid-cols-2 @min-[56rem]:grid-cols-4">
        <Filter
          label={t("Тип изменения", "Өзгеріс түрі", "Change type")}
          value={change}
          onChange={(value) => update({ change: value })}
          options={[
            {
              value: "all",
              label: t("Все изменения", "Барлық өзгерістер", "All changes"),
            },
            {
              value: "reassigned",
              label: t("Переданы, разделены, объединены", "Берілген, бөлінген, біріктірілген", "Transferred, split or merged"),
            },
            ...changeTypes.map((value) => ({
              value,
              label: changeLabel(value, t),
            })),
          ]}
        />
        <Filter
          label={t("Вопросы", "Сұрақтар", "Issues")}
          value={issue}
          onChange={(value) => update({ issue: value })}
          options={[
            {
              value: "all",
              label: t("Все выводы", "Барлық қорытындылар", "All findings"),
            },
            {
              value: "questions",
              label: t("Только вопросы", "Тек сұрақтар", "Only issues"),
            },
            ...issueTypes.map((value) => ({
              value,
              label: issueLabel(value, t),
            })),
          ]}
        />
        <Filter
          label={t("Проверка", "Тексеру", "Review")}
          value={review}
          onChange={(value) => update({ review: value })}
          options={[
            {
              value: "all",
              label: t(
                "Все статусы проверки",
                "Барлық тексеру күйлері",
                "All review states",
              ),
            },
            ...reviewStatuses.map((value) => ({
              value,
              label: reviewLabel(value, t),
            })),
          ]}
        />
        <Filter
          label={t("Подразделение", "Бөлімше", "Unit")}
          value={unit}
          onChange={(value) => update({ unit: value })}
          options={[
            {
              value: "all",
              label: t("Все подразделения", "Барлық бөлімшелер", "All units"),
            },
            ...units.map((item) => ({
              value: item.id,
              label: `${item.side === "before" ? t("До", "Дейін", "Before") : t("После", "Кейін", "After")} · ${item.name_original}`,
            })),
          ]}
        />
      </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {t("Показано", "Көрсетілген", "Showing")}: {filtered.length} /{" "}
          {findings.length}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            update({
              q: null,
              change: null,
              issue: null,
              review: null,
              unit: null,
            })
          }
        >
          {t("Сбросить фильтры", "Сүзгілерді тазалау", "Reset filters")}
        </Button>
      </div>
      <DataTable
        table={table}
        emptyMessage={t(
          "Нет выводов для выбранных фильтров.",
          "Таңдалған сүзгілер бойынша қорытынды жоқ.",
          "No findings match these filters.",
        )}
      />
    </div>
  );
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-auto min-h-9 w-full min-w-0 text-left [&>span]:whitespace-normal [&>span]:break-words">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
