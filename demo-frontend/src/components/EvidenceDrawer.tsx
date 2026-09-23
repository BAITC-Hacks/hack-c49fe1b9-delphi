import { Copy, SearchX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClauseFragment } from "@/components/ClauseFragment";
import { EmptyState } from "@/components/EmptyState";
import { ReviewControls } from "@/components/ReviewControls";
import { StatusChip } from "@/components/StatusChip";
import { citeRef } from "@/lib/format";
import type { ClauseRef, EvidenceRequest, ReviewStatus } from "@/types";

interface Props {
  request: EvidenceRequest | null;
  analysisId: string;
  onClose(): void;
  /** Live results only: saves a human review of the finding shown in the drawer. */
  onReview?(findingId: string, status: ReviewStatus, note: string): Promise<void>;
}

function copyCite(ref: ClauseRef) {
  const text = citeRef(ref);
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(`Скопировано: ${text}`))
    .catch(() => toast.error("Не удалось скопировать"));
}

function Column({ label, refs, analysisId }: { label: "До" | "После"; refs: ClauseRef[]; analysisId: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={`Комплект «${label}»`}>
      {refs.length === 0 ? (
        <EmptyState
          icon={SearchX}
          tone="amber"
          title="В этом комплекте соответствие не найдено"
          description="Функция могла сменить исполнителя, номер или формулировку. Проверьте вручную по источнику."
          className="min-h-32"
        />
      ) : (
        refs.map((ref, i) => (
          <div key={`${ref.document_id}:${ref.clause_id}:${i}`} className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {label} · {ref.edition} · <span className="font-mono">п. {ref.clause_number}</span>
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => copyCite(ref)}
                aria-label={`Скопировать ссылку ${citeRef(ref)}`}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                Скопировать ссылку
              </Button>
            </div>
            <ClauseFragment ref_={ref} analysisId={analysisId} />
          </div>
        ))
      )}
    </section>
  );
}

/** Side-by-side source fragments. Everything shown here is verbatim document text (DESIGN.md §4.5). */
export function EvidenceDrawer({ request, analysisId, onClose, onReview }: Props) {
  return (
    <Sheet open={!!request} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[720px]">
        {request && (
          <>
            <SheetHeader className="border-b px-5 py-4 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={request.status} kind={request.kind} size="md" />
              </div>
              <SheetTitle className="text-base leading-snug">{request.title}</SheetTitle>
              <SheetDescription>Фрагменты приводятся дословно по исходным документам.</SheetDescription>
              {request.note && <p className="text-xs text-muted-foreground">{request.note}</p>}
            </SheetHeader>
            <ScrollArea className="flex-1">
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <Column label="До" refs={request.before ?? []} analysisId={analysisId} />
                <Column label="После" refs={request.after ?? []} analysisId={analysisId} />
              </div>
            </ScrollArea>
            {onReview && request.finding_id && (
              <ReviewControls findingId={request.finding_id} review={request.review} onSave={onReview} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
