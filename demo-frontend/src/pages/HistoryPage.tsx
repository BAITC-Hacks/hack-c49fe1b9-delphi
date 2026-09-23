import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderOpen, PlayCircle, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { DEMO_ID, getHealth, listAnalyses, type AnalysisSummary } from "@/lib/api";
import type { ApiHealth } from "@/types";

const STATE_LABEL: Record<string, string> = {
  draft: "Черновик",
  running: "Выполняется",
  done: "Готов",
  partial: "Частичный результат",
  error: "Ошибка",
  interrupted: "Прерван",
};

/** History is the start page (product.md §3.2): no marketing screen, just past analyses and two actions. */
export default function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AnalysisSummary[] | null>(null);
  const [health, setHealth] = useState<ApiHealth | "down" | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAnalyses()
      .then((list) => !cancelled && setItems(list))
      .catch(() => !cancelled && setItems([])); // backend absent → empty history, UI still usable
    getHealth()
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth("down"));
    return () => {
      cancelled = true;
    };
  }, []);

  const hasDocs = items?.some((a) => a.documents_before != null || a.documents_after != null) ?? false;
  const hasQuestions = items?.some((a) => a.open_questions != null) ?? false;
  /** Running and failed runs open the progress screen (it offers «Повторить анализ»), finished ones the result. */
  const linkFor = (a: AnalysisSummary) =>
    a.run_id && ["running", "error", "interrupted"].includes(a.state)
      ? { to: `/runs/${encodeURIComponent(a.run_id)}`, label: a.state === "running" ? "К прогрессу" : "Подробнее" }
      : a.state === "draft"
        ? null
        : { to: `/analyses/${encodeURIComponent(a.id)}`, label: "Открыть" };

  return (
    <AppShell showNew={false}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              История анализов
              {health === "down" && (
                <Badge variant="outline" className="font-normal">
                  Сервер анализа недоступен — работает пример
                </Badge>
              )}
              {health && health !== "down" && !health.ai_configured && (
                <Badge variant="outline" className="border-status-missing-fg/30 bg-status-missing-bg font-normal text-status-missing-fg">
                  ИИ не настроен
                </Badge>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Сравнения комплектов документов «До» и «После» реорганизации.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate(`/analyses/${DEMO_ID}`)}>
              <PlayCircle className="size-4" aria-hidden="true" />
              Пример: редакции 8 и 9
            </Button>
            <Button asChild className="gap-2">
              <Link to="/new">
                <Plus className="size-4" aria-hidden="true" />
                Новое сравнение
              </Link>
            </Button>
          </div>
        </div>

        {items === null ? (
          <p className="text-sm text-muted-foreground">Загрузка истории…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="Пока нет анализов"
            description="Загрузите два комплекта документов или откройте подготовленный пример."
            action={
              <Button asChild>
                <Link to="/new">Новое сравнение</Link>
              </Button>
            }
            className="min-h-48"
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Дата</TableHead>
                  {hasDocs && <TableHead>Документы</TableHead>}
                  <TableHead>Состояние</TableHead>
                  {hasQuestions && <TableHead>Вопросов</TableHead>}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.title || "Без названия"}</TableCell>
                    <TableCell className="text-muted-foreground">{a.created_at ? new Date(a.created_at).toLocaleString("ru-RU") : "—"}</TableCell>
                    {hasDocs && (
                      <TableCell className="text-muted-foreground">
                        До: {a.documents_before ?? 0} · После: {a.documents_after ?? 0}
                      </TableCell>
                    )}
                    <TableCell>{STATE_LABEL[a.state] ?? a.state}</TableCell>
                    {hasQuestions && <TableCell className="tabular-nums">{a.open_questions ?? "—"}</TableCell>}
                    <TableCell className="text-right">
                      {(() => {
                        const link = linkFor(a);
                        return link ? (
                          <Button asChild size="sm" variant="outline">
                            <Link to={link.to}>{link.label}</Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">не запускался</span>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
