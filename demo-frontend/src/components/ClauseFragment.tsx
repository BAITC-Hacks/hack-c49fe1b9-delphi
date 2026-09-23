import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useClause } from "@/hooks/useClause";
import type { ClauseRef } from "@/types";

interface Props {
  ref_: ClauseRef;
  analysisId: string;
}

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Finds `highlight` inside `text` tolerant to whitespace differences; returns [start, end] or null. */
function locate(text: string, highlight?: string): [number, number] | null {
  if (!highlight) return null;
  const direct = text.indexOf(highlight);
  if (direct >= 0) return [direct, direct + highlight.length];
  const ci = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (ci >= 0) return [ci, ci + highlight.length];
  // whitespace-insensitive scan
  const target = normalize(highlight);
  if (!target) return null;
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] !== target[0]) continue;
    let ti = 0;
    let j = i;
    while (j < lower.length && ti < target.length) {
      const c = lower[j];
      const t = target[ti];
      if (/\s/.test(c) && t === " ") {
        while (j < lower.length && /\s/.test(lower[j])) j++;
        ti++;
        continue;
      }
      if (c !== t) break;
      j++;
      ti++;
    }
    if (ti === target.length) return [i, j];
  }
  return null;
}

/** Verbatim clause text with the cited fragment highlighted. Text comes from the source, never from the model. */
export function ClauseFragment({ ref_, analysisId }: Props) {
  const { clause, error, loading } = useClause(ref_, analysisId);

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
        <AlertDescription>{error ?? "Пункт не найден"}</AlertDescription>
      </Alert>
    );
  }

  const range = locate(clause.text, ref_.highlight);
  const before = range ? clause.text.slice(0, range[0]) : clause.text;
  const mid = range ? clause.text.slice(range[0], range[1]) : "";
  const after = range ? clause.text.slice(range[1]) : "";

  return (
    <div className="flex flex-col gap-2">
      {clause.parent && <p className="text-xs text-muted-foreground">{clause.parent}</p>}
      <p className="whitespace-pre-line text-sm leading-relaxed">
        <span className="mr-1 font-mono text-xs text-muted-foreground">{clause.clause_number}.</span>
        {before}
        {mid && <mark className="rounded-sm bg-evidence-highlight px-0.5 text-foreground animate-evidence-pulse">{mid}</mark>}
        {after}
      </p>
    </div>
  );
}
