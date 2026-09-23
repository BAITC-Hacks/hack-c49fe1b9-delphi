import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderOpen, PlayCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { DEMO_ID, listAnalyses, type AnalysisSummary } from "@/lib/api";

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

  useEffect(() => {
    let cancelled = false;
    listAnalyses()
      .then((list) => !cancelled && setItems(list))
      .catch(() => !cancelled && setItems([])); // backend absent → empty history, UI still usable
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell showNew={false}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">История анализов</h1>
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
                  <TableHead>Документы</TableHead>
                  <TableHead>Состояние</TableHead>
                  <TableHead>Вопросов</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.title || "Без названия"}</TableCell>
                    <TableCell className="text-muted-foreground">{a.created_at ? new Date(a.created_at).toLocaleString("ru-RU") : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      До: {a.documents_before ?? 0} · После: {a.documents_after ?? 0}
                    </TableCell>
                    <TableCell>{STATE_LABEL[a.state] ?? a.state}</TableCell>
                    <TableCell className="tabular-nums">{a.open_questions ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to={
                            a.state === "running" && a.run_id
                              ? `/runs/${encodeURIComponent(a.run_id)}`
                              : `/analyses/${encodeURIComponent(a.id)}`
                          }
                        >
                          {a.state === "running" ? "К прогрессу" : "Открыть"}
                        </Link>
                      </Button>
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
