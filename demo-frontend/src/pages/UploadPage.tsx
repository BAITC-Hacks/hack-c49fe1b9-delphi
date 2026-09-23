import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { UploadZone } from "@/components/UploadZone";
import { createAnalysis, DEMO_ID } from "@/lib/api";

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size;

export default function UploadPage() {
  const navigate = useNavigate();
  const [before, setBefore] = useState<File[]>([]);
  const [after, setAfter] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = before.length > 0 && after.length > 0 && !submitting;
  const sameOnBothSides = before.filter((b) => after.some((a) => sameFile(a, b))).map((f) => f.name);

  /** Adds files to one side, skipping exact duplicates (name + size) with a notice. */
  const addTo = (side: "before" | "after") => (incoming: File[]) => {
    const current = side === "before" ? before : after;
    const dup = incoming.filter((f) => current.some((p) => sameFile(p, f))).map((f) => f.name);
    const fresh = incoming.filter((f) => !current.some((p) => sameFile(p, f)));
    if (dup.length) toast.info(`Уже в списке: ${dup.join(", ")}`);
    if (fresh.length) (side === "before" ? setBefore : setAfter)((prev) => [...prev, ...fresh]);
  };

  const submit = async () => {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      const { run_id } = await createAnalysis(before, after);
      navigate(`/runs/${encodeURIComponent(run_id)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось запустить анализ";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell showNew={false}>
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="max-w-prose">
          <h1 className="text-2xl font-semibold tracking-tight">Что случилось с каждой функцией после реорганизации</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Загрузите комплекты документов до и после изменений. Delphi сопоставит подразделения и обязанности,
            отделит переданные функции от действительно не найденных и покажет источник каждого вывода.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <UploadZone
            side="before"
            files={before}
            onFiles={addTo("before")}
            onRemove={(i) => setBefore((prev) => prev.filter((_, j) => j !== i))}
            disabled={submitting}
          />
          <UploadZone
            side="after"
            files={after}
            onFiles={addTo("after")}
            onRemove={(i) => setAfter((prev) => prev.filter((_, j) => j !== i))}
            disabled={submitting}
          />
        </div>

        {sameOnBothSides.length > 0 && (
          <Alert className="border-status-missing-fg/30 bg-status-missing-bg text-status-missing-fg">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Один и тот же файл в обеих сторонах</AlertTitle>
            <AlertDescription>
              {sameOnBothSides.join(", ")} — сравнение документа с самим собой покажет, что всё сохранено. Проверьте,
              что в «После» загружена новая редакция.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Анализ не запущен</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={submit} disabled={!ready}>
                Повторить
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" onClick={submit} disabled={!ready} className="gap-2">
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
              Анализировать
            </Button>
            <Button size="lg" variant="ghost" className="gap-2" onClick={() => navigate(`/analyses/${DEMO_ID}`)}>
              <PlayCircle className="size-4" aria-hidden="true" />
              Загрузить пример: редакции 8 и 9
            </Button>
          </div>
          {!submitting && (before.length === 0 || after.length === 0) && (
            <p className="text-xs text-muted-foreground" role="status">
              Нужны оба комплекта: «До» и «После». Можно загрузить несколько файлов на каждую сторону.
            </p>
          )}
        </div>

        <p className="max-w-prose text-xs text-muted-foreground">
          Анализ ограничен предоставленными документами. Сканированные PDF без текстового слоя не обрабатываются.
          Пример показывает сохранённый результат для двух редакций Положения о внутреннем аудите.
        </p>
      </div>
    </AppShell>
  );
}
