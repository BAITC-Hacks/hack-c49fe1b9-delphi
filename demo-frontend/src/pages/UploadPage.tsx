import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Loader2, PlayCircle, ServerOff } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { UploadZone } from "@/components/UploadZone";
import { describeWarnings, isInformational, plural } from "@/lib/adapter";
import { createAnalysis, deleteDocument, DEMO_ID, getHealth, LIMITS, startRun, uploadDocument } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ApiDocument, ApiHealth, ApiSide } from "@/types";

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size;
const keyOf = (side: ApiSide, f: File) => `${side}:${f.name}:${f.size}:${f.lastModified}`;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

interface UploadState {
  side: ApiSide;
  name: string;
  state: "uploading" | "done" | "error";
  doc?: ApiDocument;
  error?: string;
}

function titleFor(before: File[], after: File[]): string {
  const part = (files: File[]) => stem(files[0].name) + (files.length > 1 ? ` +${files.length - 1}` : "");
  const title = `${part(before)} → ${part(after)}`;
  return title.length <= 120
    ? title
    : `Сравнение от ${new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

/** What the parser made of a document: revision, number of blocks, warnings (scenario B). */
function DocumentLine({ u }: { u: UploadState }) {
  const gaps = u.doc?.warnings.filter((w) => !isInformational(w)) ?? [];
  const info = u.doc?.warnings.filter(isInformational) ?? [];
  return (
    <li className="flex items-start gap-2 text-sm">
      {u.state === "uploading" ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : u.state === "error" ? (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      ) : gaps.length ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-missing-fg" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-new-fg" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="truncate">
          <span className="text-muted-foreground">{u.side === "before" ? "До" : "После"} · </span>
          {u.name}
        </p>
        <p className={cn("text-xs text-muted-foreground", u.state === "error" && "text-destructive")}>
          {u.state === "uploading" && "Загрузка и чтение…"}
          {u.state === "error" && u.error}
          {u.state === "done" && u.doc && (
            <>
              {u.doc.revision_label ? `ред. ${u.doc.revision_label} · ` : ""}
              {u.doc.block_count} {plural(u.doc.block_count, "фрагмент", "фрагмента", "фрагментов")} текста
              {gaps.length > 0 && ` · прочитан частично: ${describeWarnings(gaps).join(", ")}`}
              {info.length > 0 && ` · ${describeWarnings(info).join(", ")}`}
            </>
          )}
        </p>
      </div>
    </li>
  );
}

export default function UploadPage() {
  const navigate = useNavigate();
  const [before, setBefore] = useState<File[]>([]);
  const [after, setAfter] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<ApiHealth | "down" | null>(null);
  /** Draft analysis on the server; reused on retry so already uploaded files are not sent twice. */
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [allowPartial, setAllowPartial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth("down"));
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = before.length > 0 && after.length > 0 && !submitting;
  const sameOnBothSides = before.filter((b) => after.some((a) => sameFile(a, b))).map((f) => f.name);
  const current = [...before.map((f) => ["before", f] as const), ...after.map((f) => ["after", f] as const)];
  const shown = current.map(([side, f]) => uploads[keyOf(side, f)]).filter((u): u is UploadState => !!u);
  const partialDocs = shown.filter((u) => u.doc?.parse_status === "partial");
  const needsPartialConsent = partialDocs.length > 0 && !allowPartial;

  /** Adds files to one side, skipping exact duplicates (name + size) and files over the server limit. */
  const addTo = (side: ApiSide) => (incoming: File[]) => {
    const list = side === "before" ? before : after;
    const big = incoming.filter((f) => f.size > LIMITS.fileBytes).map((f) => f.name);
    const dup = incoming.filter((f) => list.some((p) => sameFile(p, f))).map((f) => f.name);
    let fresh = incoming.filter((f) => f.size <= LIMITS.fileBytes && !list.some((p) => sameFile(p, f)));
    const room = LIMITS.documents - before.length - after.length;
    if (fresh.length > room) {
      toast.error(`Не больше ${LIMITS.documents} документов на сравнение`);
      fresh = fresh.slice(0, Math.max(0, room));
    }
    if (big.length) toast.error(`Больше 10 МБ: ${big.join(", ")}`);
    if (dup.length) toast.info(`Уже в списке: ${dup.join(", ")}`);
    if (fresh.length) (side === "before" ? setBefore : setAfter)((prev) => [...prev, ...fresh]);
  };

  const setUpload = (key: string, u: UploadState) => setUploads((prev) => ({ ...prev, [key]: u }));

  const submit = async () => {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      let aid = analysisId;
      if (!aid) {
        aid = (await createAnalysis(titleFor(before, after))).id;
        setAnalysisId(aid);
      }
      // Files removed from the zones since the last attempt leave the draft too.
      const keep = new Set(current.map(([side, f]) => keyOf(side, f)));
      const known = { ...uploads };
      for (const [key, u] of Object.entries(known)) {
        if (keep.has(key)) continue;
        if (u.doc) {
          try { await deleteDocument(aid, u.doc.id); }
          catch { throw new Error(`Не удалось убрать «${u.doc.filename}» из комплекта. Анализ не запущен. Повторите отправку.`); }
        }
        delete known[key];
        setUploads({ ...known });
      }
      setUploads(known);

      // One request per file, in order, so progress and errors are shown per document.
      const docs: ApiDocument[] = [];
      let failed = 0;
      for (const [side, file] of current) {
        const key = keyOf(side, file);
        const prev = known[key];
        if (prev?.state === "done" && prev.doc) {
          docs.push(prev.doc);
          continue;
        }
        setUpload(key, { side, name: file.name, state: "uploading" });
        try {
          const doc = await uploadDocument(aid, side, file);
          docs.push(doc);
          setUpload(key, { side, name: file.name, state: "done", doc });
        } catch (e) {
          failed++;
          setUpload(key, { side, name: file.name, state: "error", error: e instanceof Error ? e.message : "Не удалось загрузить" });
        }
      }
      if (failed) {
        setError(`Не загружено файлов: ${failed}. Уберите их из списка или замените и нажмите «Анализировать» ещё раз.`);
        return;
      }
      const hasPartial = docs.some((d) => d.parse_status === "partial");
      if (hasPartial && !allowPartial) return; // consent block below asks for «Запустить ограниченный анализ»

      const { run_id } = await startRun(aid, hasPartial && allowPartial);
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

        {health === "down" && (
          <Alert>
            <ServerOff className="size-4" aria-hidden="true" />
            <AlertTitle>Сервер анализа недоступен</AlertTitle>
            <AlertDescription>Новое сравнение сейчас не запустится. Сохранённый пример открывается без сервера.</AlertDescription>
          </Alert>
        )}
        {health && health !== "down" && !health.ai_configured && (
          <Alert className="border-status-missing-fg/30 bg-status-missing-bg text-status-missing-fg">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>ИИ не настроен на сервере</AlertTitle>
            <AlertDescription>
              Документы можно загрузить и проверить, как они прочитаны. Запуск анализа станет доступен после настройки ключа модели.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
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
          <p className="text-xs text-muted-foreground">
            DOCX, PDF с текстовым слоем, XLSX, Markdown · до 10 МБ на файл · не больше {LIMITS.documents} документов на сравнение.
          </p>
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

        {shown.length > 0 && (
          <section className="rounded-lg border bg-card p-4" aria-label="Чтение документов">
            <h2 className="mb-3 text-sm font-medium">Как прочитаны документы</h2>
            <ul className="flex flex-col gap-2.5" aria-live="polite">
              {shown.map((u) => (
                <DocumentLine key={`${u.side}:${u.name}`} u={u} />
              ))}
            </ul>
          </section>
        )}

        {partialDocs.length > 0 && (
          <Alert className="border-status-missing-fg/30 bg-status-missing-bg text-status-missing-fg">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Часть текста прочитана не полностью</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                {partialDocs.map((u) => u.name).join(", ")}. Выводы по непрочитанным фрагментам будут неполными — это
                отразится в разделе «Ограничения» заключения.
              </span>
              <label className="flex items-center gap-2 font-medium text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={allowPartial}
                  onChange={(e) => setAllowPartial(e.target.checked)}
                  disabled={submitting}
                />
                Запустить ограниченный анализ
              </label>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Анализ не запущен</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={submit} disabled={!ready || needsPartialConsent}>
                Повторить
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" onClick={submit} disabled={!ready || needsPartialConsent} className="gap-2">
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
          {needsPartialConsent && !submitting && (
            <p className="text-xs text-muted-foreground" role="status">
              Чтобы продолжить, отметьте «Запустить ограниченный анализ» или замените документ.
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
