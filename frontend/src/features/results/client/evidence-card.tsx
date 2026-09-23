"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen, Copy } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentResponse, EvidenceResponse, SourceResponse } from "@/shared/api/generated";
import { sourceLocation } from "@/shared/documents/source-location";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { resultsApi } from "../api/results-api";
import { locateEvidence } from "../model/evidence";

export function EvidenceCard({ item, analysisId, document, onSource }: {
  item: EvidenceResponse;
  analysisId: string;
  document?: DocumentResponse;
  onSource: (id: string) => void;
}) {
  const { t } = useI18n();
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const context = useQuery({
    queryKey: ["document-sources", analysisId, item.document_id],
    queryFn: () => resultsApi.documentSources(analysisId, item.document_id),
    staleTime: Infinity,
  });
  const sources = context.data ?? [];
  const source = sources.find((block) => block.id === item.source_id);
  const ancestors: SourceResponse[] = [];
  const visited = new Set([item.source_id]);
  let parentId = source?.parent_id;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = sources.find((block) => block.id === parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parent_id;
  }
  const located = locateEvidence(item.original_text, item);
  const invalid = Boolean(located && "invalid" in located);
  const range = located && !("invalid" in located) ? located : null;
  // Clamp in code points so a compact window never splits a surrogate pair.
  const points = Array.from(item.original_text);
  const start = expanded || invalid ? 0 : Math.max(0, (range ? item.start_offset! : 0) - 110);
  const end = expanded || invalid ? points.length : Math.min(points.length, Math.max(start + 520, (range ? item.end_offset! : 0) + 110));
  const from = points.slice(0, start).join("").length;
  const to = points.slice(0, end).join("").length;
  const compact = start > 0 || end < points.length;
  const canExpand = points.length > 520 && !invalid;
  async function copyQuote() {
    try {
      await navigator.clipboard.writeText(invalid ? item.original_text : item.excerpt);
      toast.success(t("Цитата скопирована", "Дәйексөз көшірілді", "Quotation copied"));
    } catch {
      toast.error(t("Не удалось скопировать цитату", "Дәйексөзді көшіру мүмкін болмады", "Could not copy the quotation"));
    }
  }
  return (
    <article className={`min-w-0 space-y-3 rounded-lg border bg-card p-4 ${item.evidence_role === "context" ? "border-dashed" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="break-words font-medium text-foreground">{item.filename}</p>
          <p className="mt-1 break-words">
            {document?.revision_label ? `${document.revision_label} · ` : ""}
            {item.clause_no ? `${t("п.", "т.", "clause")} ${item.clause_no}` : sourceLocation(item.locator, t)}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { void copyQuote(); }}>
          <Copy className="size-3.5" aria-hidden="true" />{t("Цитата", "Дәйексөз", "Copy quote")}
        </Button>
      </div>
      {ancestors.length ? <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{t("Контекст пункта", "Тармақ контексті", "Clause context")}</summary>
        <div className="mt-2 space-y-2">{ancestors.map((parent) => <p key={parent.id} className="whitespace-pre-wrap break-words">{parent.original_text}</p>)}</div>
      </details> : null}
      {context.isError ? <p className="text-xs text-muted-foreground">{t("Контекст не загружен. Откройте исходный пункт для повторной загрузки.", "Контекст жүктелмеді. Қайта жүктеу үшін бастапқы тармақты ашыңыз.", "Context could not load. Open the source clause to retry.")}</p> : null}
      {invalid ? <p role="alert" className="text-xs text-status-missing-fg">{t("Границы цитаты не совпадают с источником. Показан полный пункт без подсветки.", "Дәйексөз шекаралары дереккөзге сәйкес емес. Толық тармақ ерекшелеусіз көрсетілген.", "The excerpt does not match its saved offsets. The full source is shown without highlighting.")}</p> : null}
      <blockquote id={textId} className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
        {from > 0 ? <span aria-label={t("Начало скрыто", "Басы жасырылған", "Earlier text hidden")}>… </span> : null}
        {range ? <>{item.original_text.slice(from, range.start)}<mark className="rounded-sm bg-evidence-highlight text-foreground">{item.original_text.slice(range.start, range.end)}</mark>{item.original_text.slice(range.end, to)}</> : item.original_text.slice(from, to)}
        {compact && to < item.original_text.length ? <span aria-label={t("Продолжение скрыто", "Жалғасы жасырылған", "Later text hidden")}> …</span> : null}
      </blockquote>
      <div className="flex flex-wrap gap-1">
        {canExpand ? <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={textId} onClick={() => setExpanded((value) => !value)}>{expanded ? t("Свернуть пункт", "Тармақты жинау", "Collapse clause") : t("Полный пункт", "Толық тармақ", "Full clause")}</Button> : null}
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onSource(item.source_id)}><BookOpen className="size-3.5" aria-hidden="true" />{t("Открыть источник", "Дереккөзді ашу", "Open source")}</Button>
      </div>
    </article>
  );
}
