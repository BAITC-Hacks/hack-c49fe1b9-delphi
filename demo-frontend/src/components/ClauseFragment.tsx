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
export function ClauseFragment({ ref_, analysisId }: Props) {
  const { clause, error, loading, reload } = useClause(ref_, analysisId);

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
  const before = range ? clause.text.slice(0, range.start) : clause.text;
  const mid = range ? clause.text.slice(range.start, range.end) : "";
  const after = range ? clause.text.slice(range.end) : "";
  // Live source blocks already start with their number ("5.3.3. …"); the demo stores it separately.
  const showNumber = !!clause.clause_number && !clause.text.trimStart().startsWith(clause.clause_number);

  return (
    <div className="flex flex-col gap-2">
      {located?.invalid && <p role="alert" className="text-xs text-status-missing-fg">Координаты цитаты не совпадают с источником. Показан полный пункт без подсветки.</p>}
      {clause.parent && <p className="text-xs text-muted-foreground">{clause.parent}</p>}
      <p className="whitespace-pre-line text-sm leading-relaxed">
        {showNumber && <span className="mr-1 font-mono text-xs text-muted-foreground">{clause.clause_number}.</span>}
        {before}
        {mid && <mark className="rounded-sm bg-evidence-highlight px-0.5 text-foreground animate-evidence-pulse">{mid}</mark>}
        {after}
      </p>
    </div>
  );
}
