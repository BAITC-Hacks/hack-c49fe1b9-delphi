import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TraceItem } from "@/types";

const TOOL_LABELS: Record<string, string> = {
  search_clauses: "Поиск пункта по смыслу",
  get_clause: "Чтение пункта",
  get_unit_functions: "Функции подразделения",
  check_references: "Проверка внутренних ссылок",
  extract_clauses: "Извлечение пунктов",
  extract_units: "Выделение подразделений",
  match_functions: "Сопоставление функций",
};

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-snug">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function TraceRow({ item, index }: { item: TraceItem; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="w-5 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
        <span className="font-mono text-xs">{item.tool}</span>
        <span className="hidden text-muted-foreground sm:inline">{TOOL_LABELS[item.tool] ?? ""}</span>
        <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{formatMs(item.ms)}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="grid gap-2 border-t px-3 py-2 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Вход</p>
            <Json value={item.input} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Выход</p>
            <Json value={item.output} />
          </div>
        </div>
      )}
    </li>
  );
}

/** Proof of agency for the jury: readable list of tool calls, not a raw JSON dump (DESIGN.md §4.6). */
export function TracePanel({ trace }: { trace: TraceItem[] }) {
  const [open, setOpen] = useState(false);
  if (!trace || trace.length === 0) return null;
  const total = trace.reduce((s, t) => s + t.ms, 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="no-print">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border bg-card px-4 py-3 text-left text-sm outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wrench className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">Как агент решал</span>
          <span className="text-muted-foreground">
            · {trace.length} {trace.length === 1 ? "вызов" : trace.length < 5 ? "вызова" : "вызовов"} инструментов · {formatMs(total)}
          </span>
          <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 flex flex-col gap-1.5">
          {trace.map((item, i) => (
            <TraceRow key={i} item={item} index={i} />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
