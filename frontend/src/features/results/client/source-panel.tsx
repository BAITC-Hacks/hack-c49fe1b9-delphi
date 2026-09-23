"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { DocumentResponse, SourceResponse } from "@/shared/api/generated";
import { sourceLocation } from "@/shared/documents/source-location";
import { useI18n } from "@/shared/i18n";
import { resultsApi } from "../api/results-api";
import { locateEvidence } from "../model/evidence";
import { RequestError } from "./request-error";

export function SourcePanel({
  sourceId,
  analysisId,
  documents,
  findingId,
  onClose,
  onSelect,
}: {
  sourceId: string | null;
  analysisId: string;
  documents: DocumentResponse[];
  findingId?: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const source = useQuery({
    queryKey: ["source", sourceId],
    queryFn: () => resultsApi.source(sourceId!),
    enabled: Boolean(sourceId),
  });
  const document = documents.find(
    (item) => item.id === source.data?.document_id,
  );
  const evidence = useQuery({
    queryKey: ["evidence", findingId],
    queryFn: () => resultsApi.evidence(findingId!),
    enabled: Boolean(sourceId && findingId),
  });
  const context = useQuery({
    queryKey: ["document-sources", analysisId, source.data?.document_id],
    queryFn: () =>
      resultsApi.documentSources(analysisId, source.data!.document_id),
    enabled: Boolean(sourceId && source.data && document),
  });
  const blocks = context.data ?? [];
  const index = blocks.findIndex((block) => block.id === sourceId);
  const ancestors: SourceResponse[] = [];
  const visited = new Set([sourceId]);
  let parentId = source.data?.parent_id;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = blocks.find((block) => block.id === parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parent_id;
  }
  const previous = index > 0 ? blocks[index - 1] : undefined;
  const next = index >= 0 ? blocks[index + 1] : undefined;
  const originalText = source.data?.original_text ?? "";
  const ranges = (evidence.data ?? []).filter((item) => item.source_id === sourceId).map((item) =>
    item.original_text !== originalText ? { invalid: true } as const : locateEvidence(originalText, item),
  );
  const invalidEvidence = ranges.some((range) => range && "invalid" in range);
  const ordered = ranges.filter((range): range is { start: number; end: number } => Boolean(range && !("invalid" in range))).sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ordered) {
    const previousRange = merged[merged.length - 1];
    if (previousRange && range.start <= previousRange.end) previousRange.end = Math.max(previousRange.end, range.end);
    else merged.push({ ...range });
  }
  let cursor = 0;
  const highlighted = merged.flatMap((range, index) => {
    const prefix = originalText.slice(cursor, range.start);
    cursor = range.end;
    return [prefix, <mark key={index} className="rounded-sm bg-evidence-highlight text-foreground">{originalText.slice(range.start, range.end)}</mark>];
  });
  highlighted.push(originalText.slice(cursor));

  return (
    <Sheet
      open={Boolean(sourceId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto bg-background sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {t("Исходный пункт", "Бастапқы тармақ", "Original source")}
            {source.data?.clause_no ? ` · ${source.data.clause_no}` : ""}
          </SheetTitle>
          <SheetDescription className="break-words">
            {document
              ? `${document.side === "before" ? t("До", "Дейін", "Before") : t("После", "Кейін", "After")} · ${document.filename}`
              : t(
                  "Текст и контекст источника",
                  "Дереккөз мәтіні мен контексті",
                  "Source text and context",
                )}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {source.isPending ? (
            <p role="status">{t("Загрузка…", "Жүктелуде…", "Loading…")}</p>
          ) : null}
          {source.isError ? (
            <RequestError
              error={source.error}
              retry={() => {
                void source.refetch();
              }}
            />
          ) : null}
          {source.data && !document ? (
            <p role="alert" className="text-sm text-destructive">
              {t(
                "Этот источник не принадлежит текущему сравнению.",
                "Бұл дереккөз ағымдағы салыстыруға жатпайды.",
                "This source does not belong to the current comparison.",
              )}
            </p>
          ) : null}
          {source.data && document ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Цитата на языке оригинала",
                  "Түпнұсқа тіліндегі дәйексөз",
                  "Quotation in its original language",
                )}
              </p>
              {document.revision_label ? <p className="text-xs font-medium text-muted-foreground">{document.revision_label} · {sourceLocation(source.data.locator, t)}</p> : null}
              {ancestors.map((parent) => (
                <div key={parent.id} className="rounded-md bg-muted p-3">
                  <p className="mb-2 text-xs font-semibold">
                    {t("Родительский пункт", "Жоғарғы тармақ", "Parent clause")}{" "}
                    {parent.clause_no}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {parent.original_text}
                  </p>
                </div>
              ))}
              {invalidEvidence ? <p role="alert" className="text-xs text-status-missing-fg">{t("Границы цитаты не совпадают с источником. Подсветка отключена.", "Дәйексөз шекаралары дереккөзге сәйкес емес. Ерекшелеу өшірілді.", "The evidence does not match this source. Highlighting is unavailable.")}</p> : null}
              <blockquote className="rounded-lg border bg-card p-4 whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
                {invalidEvidence ? originalText : highlighted}
              </blockquote>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {t(
                    "Местоположение в документе",
                    "Құжаттағы орны",
                    "Document location",
                  )}
                </summary>
                <p className="mt-2 break-words">
                  {sourceLocation(source.data.locator, t)}
                </p>
              </details>
              {context.isError ? (
                <RequestError
                  error={context.error}
                  retry={() => {
                    void context.refetch();
                  }}
                />
              ) : null}
              {previous || next ? (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!previous}
                    onClick={() => {
                      if (previous) onSelect(previous.id);
                    }}
                  >
                    {t(
                      "Предыдущий фрагмент",
                      "Алдыңғы үзінді",
                      "Previous block",
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!next}
                    onClick={() => {
                      if (next) onSelect(next.id);
                    }}
                  >
                    {t("Следующий фрагмент", "Келесі үзінді", "Next block")}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
