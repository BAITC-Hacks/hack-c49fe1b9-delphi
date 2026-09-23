import type { AnalysisResult, ClauseRef, EvidenceRequest, FunctionMapping, Risk, RiskSide } from "@/types";

/** Preserve distinct excerpts of a source, while avoiding duplicate fallback citations. */
export function uniqueRefs(refs: ClauseRef[]): ClauseRef[] {
  const excerpted = new Set(refs.filter((r) => r.highlight).map((r) => `${r.document_id}:${r.clause_id}`));
  const seen = new Set<string>();
  return refs.filter((r) => {
    const source = `${r.document_id}:${r.clause_id}`;
    if (!r.highlight && excerpted.has(source)) return false;
    const key = `${source}:${r.start_offset ?? ""}:${r.end_offset ?? ""}:${r.highlight ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const refsOfSides = (sides: RiskSide[]) => uniqueRefs(sides.flatMap((s) => s.refs));

export function functionEvidence(f: FunctionMapping): EvidenceRequest {
  return {
    title: f.title, kind: "function", status: f.status, finding_id: f.id, review: f.review,
    before: uniqueRefs([...refsOfSides(f.before), ...(f.evidence?.before ?? [])]),
    after: uniqueRefs([...refsOfSides(f.after), ...(f.evidence?.after ?? [])]),
    context: f.evidence?.context, error: f.evidence?.error,
    note: [f.note, f.search?.text].filter(Boolean).join("\n"), recommendation: f.recommendation,
    searchComplete: f.search?.complete,
    participants: [...f.before, ...f.after],
  };
}

export function riskEvidence(r: Risk): EvidenceRequest {
  const refs = refsOfSides(r.sides);
  return {
    title: r.title, kind: "risk", status: r.kind, finding_id: r.id, review: r.review,
    before: uniqueRefs([...refs.filter((ref) => ref.side === "before"), ...(r.evidence?.before ?? [])]),
    after: uniqueRefs([...refs.filter((ref) => ref.side === "after"), ...(r.evidence?.after ?? [])]),
    context: uniqueRefs([...refs.filter((ref) => !ref.side), ...(r.evidence?.context ?? [])]),
    error: r.evidence?.error, note: r.why, recommendation: r.check, participants: r.sides,
  };
}

/** A finding can appear in both maps. It is still one review decision. */
export function reviewQueue(result: AnalysisResult): EvidenceRequest[] {
  const entries = new Map<string, EvidenceRequest>();
  result.functions.forEach((f) => entries.set(f.id, functionEvidence(f)));
  result.risks.forEach((r) => {
    const previous = entries.get(r.id);
    const risk = riskEvidence(r);
    entries.set(r.id, { ...previous, ...risk,
      before: uniqueRefs([...(previous?.before ?? []), ...(risk.before ?? [])]),
      after: uniqueRefs([...(previous?.after ?? []), ...(risk.after ?? [])]),
      context: uniqueRefs([...(previous?.context ?? []), ...(risk.context ?? [])]),
      searchComplete: previous?.searchComplete,
    });
  });
  result.structureFindings?.forEach((f) => { if (f.finding_id) entries.set(f.finding_id, f); });
  const priority = (f: EvidenceRequest) => f.review?.status === "rejected" ? 5 : f.review?.status === "confirmed" ? 4
    : f.status === "missing" || f.status === "conflict" ? 0 : f.kind === "risk" ? 1 : f.status === "kept" ? 3 : 2;
  return [...entries.values()].sort((a, b) => priority(a) - priority(b));
}

export function riskSummary(result: AnalysisResult): string {
  const active = result.risks.filter((r) => r.review?.status !== "rejected");
  if (active.length) return `Вопросов для проверки: ${active.length}.`;
  if (result.risks.length) return "Все выявленные риски отклонены проверяющим. Решения сохранены в заключении.";
  if (result.coverage?.complete) return "В проверенном комплекте дублирований и конфликтов не выявлено.";
  return "В доступной части результата риски не выявлены. Полнота проверки не подтверждена — проверьте ограничения.";
}
