import { Link, useNavigate } from "react-router-dom";
import { FileText, FlaskConical, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_CASES, type DemoCase } from "@/lib/demo";
import { cn } from "@/lib/utils";

function CaseCard({ c }: { c: DemoCase }) {
  const navigate = useNavigate();
  const synthetic = c.kind === "synthetic";
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            synthetic ? "border-status-split-fg/30 bg-status-split-bg text-status-split-fg" : "bg-muted text-muted-foreground",
          )}
        >
          {synthetic ? <FlaskConical className="size-3.5" aria-hidden="true" /> : <FileText className="size-3.5" aria-hidden="true" />}
          {synthetic ? "Синтетика" : "Реальные документы (обезличены)"}
        </span>
      </div>
      <div>
        <h2 className="text-base font-semibold leading-snug">{c.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{c.shows}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">«До»</dt>
        <dd className="min-w-0 truncate font-mono">{c.before.join(", ")}</dd>
        <dt className="text-muted-foreground">«После»</dt>
        <dd className="min-w-0 truncate font-mono">{c.after.join(", ")}</dd>
      </dl>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => navigate(`/runs/demo:${encodeURIComponent(c.id)}`)}>
          <Play className="size-4" aria-hidden="true" />
          Показать анализ
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`/analyses/${encodeURIComponent(c.id)}`}>Сразу к результату</Link>
        </Button>
      </div>
    </li>
  );
}

/** Demo build: instead of uploading files, pick a prepared set; the analysis is replayed from the saved result. */
export default function DemoStartPage() {
  return (
    <AppShell showNew={false}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="max-w-prose">
          <h1 className="text-2xl font-semibold tracking-tight">Что случилось с каждой функцией после реорганизации</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Выберите комплект «До» и «После». Delphi покажет, какие обязанности сохранились, какие перешли к другому
            исполнителю, для каких соответствие не найдено и где возникают пересечения — с дословным источником каждого
            вывода.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Демо-версия показывает сохранённые результаты: модель не вызывается, свои файлы здесь не анализируются. Живой
            анализ — в основном приложении Delphi.
          </p>
        </div>
        <ul className="grid gap-4 md:grid-cols-2">
          {DEMO_CASES.map((c) => (
            <CaseCard key={c.id} c={c} />
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
