import { functionEvidence } from "@/lib/evidence";
import { useMemo, useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";
import { ReviewChip } from "@/components/ReviewControls";
import { StatusChip } from "@/components/StatusChip";
import { confidenceHint, percent } from "@/lib/format";
import { FUNCTION_SORT, FUNCTION_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { EvidenceRequest, FunctionMapping, FunctionStatus } from "@/types";

interface Props {
  functions: FunctionMapping[];
  onEvidence(req: EvidenceRequest): void;
}

function Confidence({ value }: { value: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2" aria-label={`Уверенность ${percent(value)}`}>
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: percent(value) }} />
          </div>
          <span className="w-10 text-xs tabular-nums text-muted-foreground">{percent(value)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{confidenceHint(value)}</TooltipContent>
    </Tooltip>
  );
}

export function FunctionMapTable({ functions, onEvidence }: Props) {
  const [active, setActive] = useState<Set<FunctionStatus>>(new Set());
  const [query, setQuery] = useState("");

  const present = useMemo(() => {
    const s = new Set<FunctionStatus>();
    functions.forEach((f) => s.add(f.status));
    return FUNCTION_SORT.filter((st) => s.has(st));
  }, [functions]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return functions
      .filter((f) => active.size === 0 || active.has(f.status))
      .filter((f) => {
        if (!q) return true;
        const hay = [
          f.title,
          f.note ?? "",
          ...[...f.before, ...f.after].flatMap((a) => [a.unit, a.summary, ...a.refs.map((r) => r.clause_number)]),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        // rejected by the reviewer: kept visible, but below everything that still needs attention
        const r = Number(a.review?.status === "rejected") - Number(b.review?.status === "rejected");
        if (r !== 0) return r;
        const d = FUNCTION_SORT.indexOf(a.status) - FUNCTION_SORT.indexOf(b.status);
        return d !== 0 ? d : (b.confidence ?? 0) - (a.confidence ?? 0);
      });
  }, [functions, active, query]);

  const toggle = (st: FunctionStatus) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return next;
    });

  const open = (f: FunctionMapping) => onEvidence(functionEvidence(f));

  return (
    <div className="flex flex-col gap-3">
      <div className="no-print flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          <ListFilter className="size-4 text-muted-foreground" aria-hidden="true" />
          {present.map((st) => {
            const meta = FUNCTION_STATUS[st];
            const Icon = meta.icon;
            const on = active.has(st);
            return (
              <button
                key={st}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(st)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors duration-150",
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  on ? meta.className : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {meta.label}
              </button>
            );
          })}
          {active.size > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setActive(new Set())}>
              Сбросить
            </Button>
          )}
        </div>
        <div className="relative md:ml-auto md:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по функциям"
            className="h-8 pl-8"
            aria-label="Поиск по функциям"
          />
        </div>
      </div>

      {functions.length === 0 ? (
        <EmptyState
          icon={Search}
          title="В этом результате нет сопоставленных функций"
          description="Вывод относится к пересечению или конфликту пунктов «После» — он показан ниже, в «Вопросах для проверки»."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="По фильтру ничего не найдено"
          action={
            <Button variant="outline" size="sm" onClick={() => { setActive(new Set()); setQuery(""); }}>
              Сбросить
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[31%]">Функция («До»)</TableHead>
                  <TableHead className="w-[25%]">Исполнитель «После»</TableHead>
                  <TableHead className="w-[20%]">Статус</TableHead>
                  <TableHead className="w-[12%]">Уверенность</TableHead>
                  <TableHead className="w-[12%]">Источник</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f, i) => (
                  <TableRow
                    key={f.id}
                    className={cn("animate-in fade-in slide-in-from-bottom-1 duration-150", f.review?.status === "rejected" && "opacity-60")}
                    style={{ animationDelay: `${Math.min(i, 12) * 20}ms`, animationFillMode: "both" }}
                  >
                    <TableCell className="align-top">
                      <p className="font-medium">{f.title}</p>
                      {f.before.length > 0 && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {f.before.map((s) => s.unit).join("; ")} · <span className="font-mono">п. {f.before.flatMap((s) => s.refs.map((r) => r.clause_number)).join("; ")}</span>
                        </p>
                      )}
                      {f.note && <p className="mt-1 max-w-prose text-xs text-muted-foreground">{f.note}</p>}
                    </TableCell>
                    <TableCell className="align-top">
                      {f.after && f.after.length > 0 ? (
                        <ul className="flex flex-col gap-1">
                          {f.after.map((a, j) => (
                            <li key={j} className="text-sm">
                              {a.unit} · <span className="font-mono text-xs text-muted-foreground">п. {a.refs.map((r) => r.clause_number).join("; ")}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-sm text-status-missing-fg">Соответствие не найдено</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <StatusChip status={f.status} />
                        <ReviewChip review={f.review} />
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {f.confidence != null ? <Confidence value={f.confidence} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="align-top">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => open(f)}>
                        Источник
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((f) => (
              <li key={f.id} className={cn("rounded-lg border bg-card p-3", f.review?.status === "rejected" && "opacity-60")}>
                <div className="flex flex-col items-start gap-2">
                  <p className="font-medium">{f.title}</p>
                  <div className="flex flex-wrap items-start gap-1">
                    <StatusChip status={f.status} />
                    <ReviewChip review={f.review} />
                  </div>
                </div>
                {f.before.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    До: {f.before.map((s) => s.unit).join("; ")} · <span className="font-mono">п. {f.before.flatMap((s) => s.refs.map((r) => r.clause_number)).join("; ")}</span>
                  </p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  После:{" "}
                  {f.after && f.after.length > 0
                    ? f.after.map((a) => `${a.unit} · п. ${a.refs.map((r) => r.clause_number).join("; ")}`).join("; ")
                    : "соответствие не найдено"}
                </p>
                {f.note && <p className="mt-1 text-xs text-muted-foreground">{f.note}</p>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  {f.confidence != null ? <Confidence value={f.confidence} /> : <span />}
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => open(f)}>
                    Источник
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Показано {rows.length} из {functions.length}. Строки «Соответствие не найдено» — первыми: это то, что проверяет человек.
      </p>

    </div>
  );
}
