import { useEffect, useRef } from "react";
import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { ReviewChip } from "@/components/ReviewControls";
import { StatusChip } from "@/components/StatusChip";
import { metaFor } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { QueueItem, ReviewScope } from "@/hooks/useReviewQueue";

const SCOPE_LABELS: [ReviewScope, string][] = [
  ["unreviewed", "Непроверенные"],
  ["needs_clarification", "Нужно уточнение"],
  ["rejected", "Отклонённые"],
  ["confirmed", "Подтверждённые"],
  ["all", "Все"],
];

interface Props {
  items: QueueItem[];
  selectedId?: string;
  scope: ReviewScope;
  statuses: Set<string>;
  presentStatuses: string[];
  quietCount: number;
  withQuiet: boolean;
  onSelect(id: string): void;
  onScope(scope: ReviewScope): void;
  onToggleStatus(status: string): void;
  onWithQuiet(on: boolean): void;
  onReset(): void;
}

const kindOf = (s: string) => (metaFor("risk", s) && !metaFor("function", s) ? "risk" : "function");

/** Left pane: the questions, most urgent first. Selection scrolls into view so the place is never lost. */
export function QueueList(props: Props) {
  const { items, selectedId, scope, statuses, presentStatuses, quietCount, withQuiet } = props;
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Какие выводы показать">
          {SCOPE_LABELS.map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              onClick={() => props.onScope(s)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                scope === s ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {presentStatuses.length > 1 && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Фильтр по типу изменения">
            <ListFilter className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {presentStatuses.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statuses.has(s)}
                onClick={() => props.onToggleStatus(s)}
                className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", !statuses.has(s) && statuses.size > 0 && "opacity-50")}
              >
                <StatusChip status={s} kind={kindOf(s)} />
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={ListFilter}
          title={scope === "unreviewed" && statuses.size === 0 ? "Все вопросы проверены" : "По фильтру ничего нет"}
          description={scope === "unreviewed" && statuses.size === 0 ? "Решения сохранены и уже учтены в заключении." : undefined}
          action={
            <Button size="sm" variant="outline" onClick={props.onReset}>
              Показать все
            </Button>
          }
          className="min-h-40"
        />
      ) : (
        <ul ref={listRef} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1" aria-label="Очередь вопросов">
          {items.map((item) => {
            const active = item.id === selectedId;
            return (
              <li key={item.id} data-id={item.id}>
                <button
                  type="button"
                  onClick={() => props.onSelect(item.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "border-primary ring-1 ring-primary" : "hover:bg-muted/60",
                    item.review.status === "rejected" && "opacity-70",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip status={item.status} kind={item.kind} />
                    {item.searchIncomplete && <span className="text-xs font-medium text-status-missing-fg">неполный поиск</span>}
                    <ReviewChip review={item.review} className="ml-auto" />
                  </div>
                  <p className="text-sm font-medium leading-snug">{item.title}</p>
                  {(item.fromUnits.length > 0 || item.toUnits.length > 0) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {item.fromUnits.join(", ") || "—"} → {item.toUnits.join(", ") || "не найдено в «После»"}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {quietCount > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="size-3.5 accent-primary" checked={withQuiet} onChange={(e) => props.onWithQuiet(e.target.checked)} />
          Показать функции без изменений ({quietCount})
        </label>
      )}
    </div>
  );
}
