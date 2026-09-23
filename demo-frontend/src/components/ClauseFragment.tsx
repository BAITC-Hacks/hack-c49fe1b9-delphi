import { useId, useState } from "react";
import { locateEvidence } from "@/lib/highlight";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useClause } from "@/hooks/useClause";
import type { ClauseRef } from "@/types";

interface Props {
  ref_: ClauseRef;
  analysisId: string;
}

/** Verbatim clause text with the cited fragment highlighted. Text comes from the source, never from the model. */
export function clauseExcerptRange(text: string, evidence: { start: number; end: number } | null) {
  if (text.length <= 420) return { start: 0, end: text.length };
  const from = Math.max(0, (evidence?.start ?? 0) - 120);
  const to = Math.min(text.length, Math.max(from + 420, (evidence?.end ?? 0) + 120));
  const precedingSpace = text.lastIndexOf(" ", from);
  const followingSpace = text.indexOf(" ", to);
  return {
    start: from === 0 ? 0 : Math.max(0, precedingSpace + 1),
    end: to === text.length || followingSpace === -1 ? text.length : followingSpace,
  };
}

export function ClauseFragment({ ref_, analysisId }: Props) {
  const { clause, error, loading, reload } = useClause(ref_, analysisId);
  const textId = useId();
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const sourceKey = JSON.stringify([analysisId, ref_]);
  const expanded = expandedSource === sourceKey;

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (error || !clause) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? "Пункт не найден"}<Button variant="outline" size="sm" onClick={reload}>Повторить загрузку пункта</Button></AlertDescription>
      </Alert>
    );
  }

  const located = locateEvidence(clause.text, ref_);
  const range = located && !located.invalid ? located : null;
  const compact = located?.invalid ? { start: 0, end: clause.text.length } : clauseExcerptRange(clause.text, range);
  const canExpand = compact.start > 0 || compact.end < clause.text.length;
  const visible = expanded ? { start: 0, end: clause.text.length } : compact;
  const before = range ? clause.text.slice(visible.start, range.start) : clause.text.slice(visible.start, visible.end);
  const mid = range ? clause.text.slice(range.start, range.end) : "";
  const after = range ? clause.text.slice(range.end, visible.end) : "";
  // Live source blocks already start with their number ("5.3.3. …"); the demo stores it separately.
  const showNumber = !!clause.clause_number && !clause.text.trimStart().startsWith(clause.clause_number);

  return (
    <div className="flex flex-col gap-2">
      {located?.invalid && <p role="alert" className="text-xs text-status-missing-fg">Координаты цитаты не совпадают с источником. Показан полный пункт без подсветки.</p>}
      {clause.parent && <p className="text-xs text-muted-foreground">{clause.parent}</p>}
      <p id={textId} className="whitespace-pre-line text-sm leading-relaxed">
        {showNumber && <span className="mr-1 font-mono text-xs text-muted-foreground">{clause.clause_number}.</span>}
        {visible.start > 0 && <span aria-label="Начало пункта скрыто">… </span>}
        {before}
        {mid && <mark className="rounded-sm bg-evidence-highlight px-0.5 text-foreground animate-evidence-pulse">{mid}</mark>}
        {after}
        {visible.end < clause.text.length && <span aria-label="Продолжение пункта скрыто"> …</span>}
      </p>
      {canExpand && <Button variant="ghost" size="sm" className="self-start" aria-expanded={expanded} aria-controls={textId} onClick={() => setExpandedSource(expanded ? null : sourceKey)}>
        {expanded ? "Свернуть пункт" : "Показать полный пункт"}
      </Button>}
    </div>
  );
}
