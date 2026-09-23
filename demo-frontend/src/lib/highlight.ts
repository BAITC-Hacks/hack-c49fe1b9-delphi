import type { ClauseRef } from "@/types";

export type HighlightRange = { start: number; end: number; invalid?: false } | { invalid: true } | null;

/** Backend offsets count Unicode code points (Python), DOM slicing counts UTF-16 units. */
export function locateEvidence(text: string, ref: Pick<ClauseRef, "highlight" | "start_offset" | "end_offset">): HighlightRange {
  const { start_offset: start, end_offset: end, highlight } = ref;
  if (start != null || end != null) {
    const points = Array.from(text);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start == null || end == null || start < 0 || end <= start || end > points.length)
      return { invalid: true };
    const fragment = points.slice(start, end).join("");
    if (highlight && fragment !== highlight) return { invalid: true };
    const from = points.slice(0, start).join("").length;
    return { start: from, end: from + fragment.length };
  }
  // Older demo citations have no offsets. Highlight only an unambiguous occurrence.
  if (!highlight?.trim()) return null;
  const escaped = highlight.trim().split(/\s+/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const matches = [...text.matchAll(new RegExp(escaped, "giu"))];
  if (matches.length !== 1) return null;
  return { start: matches[0].index!, end: matches[0].index! + matches[0][0].length };
}
