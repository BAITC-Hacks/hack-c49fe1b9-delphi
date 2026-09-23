import type { EvidenceResponse, FindingResponse } from "@/shared/api/generated";

export type EvidenceRange = { start: number; end: number } | { invalid: true } | null;

/** Saved offsets are Python Unicode code points; rendered slices use UTF-16. */
export function locateEvidence(
  text: string,
  evidence: Pick<EvidenceResponse, "start_offset" | "end_offset" | "excerpt">,
): EvidenceRange {
  const { start_offset: start, end_offset: end, excerpt } = evidence;
  if (start == null && end == null) return excerpt === text ? null : { invalid: true };
  const points = Array.from(text);
  if (start == null || end == null || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > points.length) return { invalid: true };
  const fragment = points.slice(start, end).join("");
  if (fragment !== excerpt) return { invalid: true };
  const from = points.slice(0, start).join("").length;
  return { start: from, end: from + fragment.length };
}

export function groupEvidence(items: EvidenceResponse[]) {
  const groups: Record<"before" | "after" | "context", EvidenceResponse[]> = {
    before: [], after: [], context: [],
  };
  const seen = new Set<string>();
  for (const item of items) {
    const key = JSON.stringify([item.source_id, item.evidence_role, item.start_offset,
      item.end_offset, item.original_text, item.excerpt]);
    if (seen.has(key)) continue;
    seen.add(key);
    // A malformed side never becomes direct supporting evidence.
    const role = item.evidence_role === item.side ? item.side : "context";
    groups[role].push(item);
  }
  return groups;
}

export function comparisonPair(finding: FindingResponse, items: EvidenceResponse[]) {
  const { before, after } = groupEvidence(items);
  if (finding.before_function_ids.length !== 1 || finding.after_function_ids.length !== 1
    || before.length !== 1 || after.length !== 1
    || ["split", "merged"].includes(finding.change_type)
    || finding.issue_type === "overlap" || finding.issue_type === "potential_conflict") return null;
  if ([before[0], after[0]].some((item) => {
    const range = locateEvidence(item.original_text, item);
    return range && "invalid" in range;
  })) return null;
  return { before: before[0], after: after[0] };
}

export type DiffPart = { kind: "same" | "del" | "ins"; text: string };
const MAX_TOKENS = 600;
const MAX_CHARACTERS = 60_000;

/** Bounded LCS. Each side can be reconstructed exactly, including whitespace. */
export function diffWords(before: string, after: string): DiffPart[] | null {
  if (before.length > MAX_CHARACTERS || after.length > MAX_CHARACTERS) return null;
  const x = before.match(/\S+|\s+/g) ?? [];
  const y = after.match(/\S+|\s+/g) ?? [];
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) return null;
  const rows = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      rows[i][j] = x[i] === y[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const previous = parts[parts.length - 1];
    if (previous?.kind === kind) previous.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { push("same", x[i]); i++; j++; }
    else if (rows[i + 1][j] >= rows[i][j + 1]) push("del", x[i++]);
    else push("ins", y[j++]);
  }
  while (i < x.length) push("del", x[i++]);
  while (j < y.length) push("ins", y[j++]);
  return parts;
}
