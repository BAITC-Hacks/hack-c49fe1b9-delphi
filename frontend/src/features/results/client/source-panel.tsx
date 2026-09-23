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
import type { DocumentResponse } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { resultsApi } from "../api/results-api";
import { RequestError } from "./request-error";

export function SourcePanel({
  sourceId,
  analysisId,
  documents,
  onClose,
  onSelect,
}: {
  sourceId: string | null;
  analysisId: string;
  documents: DocumentResponse[];
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
  const context = useQuery({
    queryKey: ["document-sources", analysisId, source.data?.document_id],
    queryFn: () =>
      resultsApi.documentSources(analysisId, source.data!.document_id),
    enabled: Boolean(sourceId && source.data),
  });
  const blocks = context.data ?? [];
  const index = blocks.findIndex((block) => block.id === sourceId);
  const parent = blocks.find((block) => block.id === source.data?.parent_id);
  const previous = index > 0 ? blocks[index - 1] : undefined;
  const next = index >= 0 ? blocks[index + 1] : undefined;

  return (
    <Sheet
      open={Boolean(sourceId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
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
          {source.data ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Цитата на языке оригинала",
                  "Түпнұсқа тіліндегі дәйексөз",
                  "Quotation in its original language",
                )}
              </p>
              {parent ? (
                <div className="rounded-md bg-muted p-3">
                  <p className="mb-2 text-xs font-semibold">
                    {t("Родительский пункт", "Жоғарғы тармақ", "Parent clause")}{" "}
                    {parent.clause_no}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {parent.original_text}
                  </p>
                </div>
              ) : null}
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary pl-4 text-sm leading-relaxed">
                {source.data.original_text}
              </blockquote>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {t(
                    "Местоположение в документе",
                    "Құжаттағы орны",
                    "Document location",
                  )}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">
                  {JSON.stringify(source.data.locator, null, 2)}
                </pre>
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
