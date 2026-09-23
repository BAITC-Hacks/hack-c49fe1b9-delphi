import type {
  FindingResponse,
  FunctionResponse,
  SourceResponse,
  UnitResponse,
} from "@/shared/api/generated";

export type FindingFilters = {
  query?: string;
  change?: string;
  issue?: string;
  review?: string;
  unit?: string;
};

export function findingPriority(finding: FindingResponse) {
  if (finding.change_type === "potentially_missing")
    return finding.search?.complete === true && !finding.search.input_partial ? 1 : 0;
  if (finding.issue_type === "potential_conflict") return 2;
  if (finding.issue_type === "overlap") return 3;
  if (finding.issue_type === "insufficient_evidence") return 4;
  if (finding.change_type === "transferred") return 5;
  if (finding.change_type === "split" || finding.change_type === "merged") return 6;
  if (finding.issue_type) return 7;
  if (finding.change_type === "reworded") return 8;
  if (finding.change_type === "retained" || finding.change_type === "new") return 10;
  return 9;
}

export function prioritizeFindings(findings: FindingResponse[]) {
  return [...findings].sort(
    (left, right) =>
      Number(left.review.status === "rejected") - Number(right.review.status === "rejected") ||
      findingPriority(left) - findingPriority(right),
  );
}

export function filterFindings(
  findings: FindingResponse[],
  functions: FunctionResponse[],
  sources: SourceResponse[],
  filters: FindingFilters,
) {
  const functionMap = new Map(functions.map((item) => [item.id, item]));
  const sourceMap = new Map(sources.map((item) => [item.id, item]));
  const query = filters.query?.trim().toLocaleLowerCase();
  return findings.filter((finding) => {
    const linked = [...finding.before_function_ids, ...finding.after_function_ids]
      .flatMap((id) => functionMap.get(id) ?? []);
    const searchable = [
      finding.title,
      finding.explanation,
      finding.recommendation,
      ...linked.flatMap((item) => [item.actor_original, item.action, item.object, item.scope]),
      ...finding.source_ids.map((id) => sourceMap.get(id)?.clause_no ?? ""),
    ].join(" ").toLocaleLowerCase();
    const { change = "all", issue = "all", review = "all", unit = "all" } = filters;
    return (
      (!query || searchable.includes(query)) &&
      (change === "all" || (change === "reassigned"
        ? ["transferred", "split", "merged"].includes(finding.change_type)
        : finding.change_type === change)) &&
      (issue === "all" || (issue === "questions"
        ? finding.issue_type !== null || finding.change_type === "potentially_missing"
        : finding.issue_type === issue)) &&
      (review === "all" || finding.review.status === review) &&
      (unit === "all" || linked.some((item) => item.owner_unit_ids.includes(unit)))
    );
  });
}

export function findingOwners(ids: string[], functions: FunctionResponse[], units: UnitResponse[]) {
  const functionMap = new Map(functions.map((item) => [item.id, item]));
  const unitMap = new Map(units.map((item) => [item.id, item]));
  return [...new Set(ids.flatMap((id) => {
    const item = functionMap.get(id);
    if (!item) return [];
    return item.owner_unit_ids.length
      ? item.owner_unit_ids.map((owner) => unitMap.get(owner)?.name_original ?? item.actor_original)
      : [item.actor_original];
  }))].join(" / ") || "—";
}

export function nextUnreviewedFinding(findings: FindingResponse[], savedId: string) {
  const index = findings.findIndex((finding) => finding.id === savedId);
  const remaining = [...findings.slice(index + 1), ...findings.slice(0, Math.max(index, 0))];
  return remaining.find((finding) => finding.id !== savedId && finding.review.status === "unreviewed")?.id;
}
