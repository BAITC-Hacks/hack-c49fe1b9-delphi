import { Skeleton } from "@/components/ui/skeleton";
import { useClause } from "@/hooks/useClause";
import type { ClauseRef } from "@/types";

type Part = { kind: "same" | "del" | "ins"; text: string };

const MAX_TOKENS = 600;

/** Word-level diff (LCS over words and spaces). Deterministic, no model involved. */
function diffWords(a: string, b: string): Part[] | null {
  const x = a.match(/\S+|\s+/g) ?? [];
  const y = b.match(/\S+|\s+/g) ?? [];
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) return null;
  const same = (i: number, j: number) => x[i] === y[j] || (/^\s+$/.test(x[i]) && /^\s+$/.test(y[j]));
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const parts: Part[] = [];
  const push = (kind: Part["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(i, j)) {
      push("same", y[j]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("del", x[i++]);
    else push("ins", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("ins", y[j++]);
  return parts;
}

/**
 * Differences between the two displayed clauses. It shows only which words differ between these passages:
 * a removed word is not proof of a lost function (docs/feedback.md §6).
 */
export function WordDiff({ before, after, analysisId }: { before: ClauseRef; after: ClauseRef; analysisId: string }) {
  const a = useClause(before, analysisId);
  const b = useClause(after, analysisId);
  if (a.loading || b.loading) return <Skeleton className="h-16 w-full" />;
  if (!a.clause || !b.clause) return null;
  const parts = diffWords(a.clause.text, b.clause.text);
  if (!parts) return <p className="text-xs text-muted-foreground">Пункты слишком длинные для пословного сравнения.</p>;
  const changed = parts.some((p) => p.kind !== "same" && p.text.trim());
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3" aria-label="Различия слов между пунктами">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Различия слов · {before.edition}, п. {before.clause_number} → {after.edition}, п. {after.clause_number}
        </h3>
        <p className="text-xs text-muted-foreground">
          <del className="rounded-sm bg-status-missing-bg px-0.5 text-status-missing-fg">зачёркнуто</del> — было в «До»,{" "}
          <ins className="rounded-sm bg-status-new-bg px-0.5 text-status-new-fg underline decoration-2 underline-offset-2">подчёркнуто</ins> — появилось в «После»
        </p>
      </div>
      {changed ? (
        <p className="whitespace-pre-line text-sm leading-relaxed">
          {parts.map((p, k) =>
            p.kind === "same" ? (
              <span key={k}>{p.text}</span>
            ) : p.kind === "del" ? (
              <del key={k} className="rounded-sm bg-status-missing-bg px-0.5 text-status-missing-fg">
                {p.text}
              </del>
            ) : (
              <ins key={k} className="rounded-sm bg-status-new-bg px-0.5 text-status-new-fg underline decoration-2 underline-offset-2">
                {p.text}
              </ins>
            ),
          )}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Тексты пунктов совпадают дословно — изменились номер или исполнитель.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Показано различие слов между этими двумя пунктами. Удалённое слово само по себе не доказывает потерю функции.
      </p>
    </section>
  );
}
