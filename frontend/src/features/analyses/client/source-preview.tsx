"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { loadDocumentSources } from "@/features/analyses/api/analyses";
import { getErrorMessage } from "@/shared/api/errors";
import type { DocumentResponse } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";

const pageSize = 30;

export function SourcePreview({ document, onClose }: { document: DocumentResponse; onClose: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const sources = useQuery({ queryKey: ["document-sources", document.id], queryFn: () => loadDocumentSources(document.analysis_id, document.id) });
  const filtered = useMemo(() => (sources.data ?? []).filter((source) => `${source.clause_no ?? ""} ${source.original_text}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [sources.data, search]);
  const shown = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-words pr-6">{document.filename}</DialogTitle>
          <DialogDescription>{t("Исходный текст сохранён без перевода. Проверьте чтение документа до запуска.", "Бастапқы мәтін аудармасыз сақталған. Іске қоспас бұрын құжаттың оқылуын тексеріңіз.", "Original text is preserved without translation. Check the parsed document before starting.")}</DialogDescription>
        </DialogHeader>
        <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder={t("Номер пункта или текст", "Тармақ нөмірі немесе мәтін", "Clause number or text")} aria-label={t("Поиск в источнике", "Дереккөзден іздеу", "Search source text")} />
        <div className="min-h-0 space-y-3 overflow-y-auto pr-2">
          {sources.isPending ? <Skeleton className="h-48 w-full" /> : null}
          {sources.isError ? <Alert variant="destructive"><AlertDescription>{getErrorMessage(sources.error)}<Button variant="outline" size="sm" onClick={() => sources.refetch()}>{t("Повторить", "Қайталау", "Retry")}</Button></AlertDescription></Alert> : null}
          {!sources.isPending && !sources.isError && !shown.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("Фрагменты не найдены", "Үзінділер табылмады", "No matching passages")}</p> : null}
          {shown.map((source) => <article key={source.id} className="rounded-md border p-4"><p className="mb-2 text-xs font-medium text-muted-foreground">{source.clause_no ? `${t("Пункт", "Тармақ", "Clause")} ${source.clause_no}` : t("Текстовый фрагмент", "Мәтін үзіндісі", "Text passage")}</p><p className="whitespace-pre-wrap break-words text-sm">{source.original_text}</p><details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">{t("Расположение в документе", "Құжаттағы орны", "Source location")}</summary><pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(source.locator, null, 2)}</pre></details></article>)}
        </div>
        {!sources.isPending && !sources.isError ? <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>{filtered.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} / ${filtered.length}` : "0"}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Назад", "Артқа", "Previous")}</Button><Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(page + 1)}>{t("Далее", "Келесі", "Next")}</Button></div></div> : null}
      </DialogContent>
    </Dialog>
  );
}
