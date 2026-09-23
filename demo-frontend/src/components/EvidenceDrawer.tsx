import { Copy, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClauseFragment } from "@/components/ClauseFragment";
import { ReviewControls } from "@/components/ReviewControls";
import { StatusChip } from "@/components/StatusChip";
import { citeRef } from "@/lib/format";
import type { ClauseRef, EvidenceRequest, ReviewStatus } from "@/types";

interface Props {
  request: EvidenceRequest | null;
  analysisId: string;
  onClose(): void;
  onReview?(findingId: string, status: ReviewStatus, note: string): Promise<void>;
  onRetry?(): void;
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Скопировано"); }
  catch { toast.error("Не удалось скопировать. Скопируйте адрес из строки браузера."); }
}

function SourceColumn({ label, refs, request, analysisId }: { label: string; refs: ClauseRef[]; request: EvidenceRequest; analysisId: string }) {
  return <section className="min-w-0 space-y-3" aria-label={label}>
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
    {refs.map((ref, i) => {
      const owners = [...new Set(request.participants?.filter((p) => p.refs.some((r) => r.clause_id === ref.clause_id && r.document_id === ref.document_id)).map((p) => p.unit))];
      return <article key={`${ref.document_id}:${ref.clause_id}:${i}`} className="rounded-lg border bg-card p-4">
        {owners.length > 0 && <p className="mb-2 text-sm font-semibold">{owners.join("; ")}</p>}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{ref.edition} · <span className="font-mono">п. {ref.clause_number}</span></p>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => copy(citeRef(ref))} aria-label={`Скопировать цитирование ${citeRef(ref)}`}><Copy className="size-3.5" aria-hidden="true" />Цитирование</Button>
        </div>
        <ClauseFragment ref_={ref} analysisId={analysisId} />
      </article>;
    })}
  </section>;
}

export function EvidenceDetails({ request, analysisId, onReview, onRetry }: Omit<Props, "onClose" | "request"> & { request: EvidenceRequest }) {
  const before = request.before ?? [];
  const after = request.after ?? [];
  const context = request.context ?? [];
  const canConfirm = !request.error && before.length + after.length + context.length > 0 && !(request.status === "missing" && request.searchComplete === false);
  const permalink = () => { const url = new URL(window.location.href); url.pathname = `/analyses/${encodeURIComponent(analysisId)}`; url.search = ""; url.searchParams.set("finding", request.finding_id!); return url.href; };
  return <div className="min-w-0">
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {request.kind !== "source" && request.status && <StatusChip status={request.status} kind={request.kind} />}
        {request.finding_id && <Button variant="ghost" size="sm" onClick={() => copy(permalink())}><Link2 className="size-4" aria-hidden="true" />Ссылка на вопрос</Button>}
      </div>
      <h2 className="text-xl font-semibold tracking-tight">{request.title}</h2>
      {request.note && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{request.note}</p>}
      {request.recommendation && <div className="rounded-lg bg-accent p-4 text-sm"><h3 className="mb-1 font-semibold">Что проверить</h3>{request.recommendation}</div>}
      {request.error && <div role="alert" className="space-y-2 rounded-lg border border-status-missing-fg/30 bg-status-missing-bg p-4 text-sm text-status-missing-fg">
        <p>Не удалось загрузить доказательства. Показаны доступные исходные фрагменты; подтвердить вывод пока нельзя.</p><p>{request.error}</p>
        {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="size-4" aria-hidden="true" />Повторить загрузку</Button>}
      </div>}
      {request.status === "missing" && request.searchComplete === undefined && <p className="rounded-lg bg-status-missing-bg p-3 text-sm text-status-missing-fg">Полнота поиска не подтверждена. Проверьте весь комплект «После» перед окончательным решением.</p>}
      {request.searchComplete === false && <p className="rounded-lg bg-status-missing-bg p-3 text-sm text-status-missing-fg">Поиск по комплекту «После» неполный. Отсутствие соответствия пока нельзя подтвердить.</p>}
      <div className={`grid min-w-0 gap-4 ${before.length && after.length ? "xl:grid-cols-2" : ""}`}>
        {before.length > 0 && <SourceColumn label="До" refs={before} request={request} analysisId={analysisId} />}
        {after.length > 0 && <SourceColumn label="После" refs={after} request={request} analysisId={analysisId} />}
      </div>
      {request.status === "new" && before.length === 0 && <p className="text-sm text-muted-foreground">Новая функция: источник «До» для этого изменения не указан.</p>}
      {request.status === "missing" && after.length === 0 && <p className="rounded-lg bg-status-missing-bg p-4 text-sm text-status-missing-fg">Соответствие не найдено в доступном комплекте «После». Проверьте полноту поиска и смену исполнителя.</p>}
      {context.length > 0 && <SourceColumn label="Дополнительный контекст" refs={context} request={request} analysisId={analysisId} />}
      {!before.length && !after.length && !context.length && <p className="text-sm text-muted-foreground">Источники для этого вывода недоступны. Это не означает, что функция отсутствует.</p>}
      <p className="text-xs text-muted-foreground">Цитаты приведены на языке оригинальных документов.</p>
    </div>
    {onReview && request.finding_id ? <ReviewControls key={request.finding_id} findingId={request.finding_id} review={request.review} onSave={onReview} canConfirm={canConfirm} /> : request.finding_id && <p className="border-t bg-muted/40 px-5 py-4 text-sm text-muted-foreground">Режим примера. Решения проверяющего сохраняются в анализе ваших документов.</p>}
  </div>;
}

export function EvidenceDrawer({ request, analysisId, onClose, onReview, onRetry }: Props) {
  return <Sheet open={!!request} onOpenChange={(open) => !open && onClose()}><SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[860px]">
    <SheetHeader className="sr-only"><SheetTitle>{request?.title ?? "Источники"}</SheetTitle><SheetDescription>Проверка вывода по исходным документам</SheetDescription></SheetHeader>
    {request && <div className="pt-8"><EvidenceDetails request={request} analysisId={analysisId} onReview={onReview} onRetry={onRetry} /></div>}
  </SheetContent></Sheet>;
}
