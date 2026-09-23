import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { functionEvidence, riskEvidence, uniqueRefs } from "@/lib/evidence";
import type { AnalysisResult, ClauseRef, FunctionStatus, Review, ReviewStatus } from "@/types";

/**
 * Review queue (main screen): every finding a human has to decide on, most urgent first.
 * One item per finding — a finding that is both a function row and a risk card appears once, as the risk.
 * Evidence comes from the same helpers as the evidence drawer (lib/evidence.ts), so both show the same quotes.
 * Filter, review scope and the selected item live in the URL, so reload and deep links keep the place.
 */

export type ReviewScope = "unreviewed" | "all" | Exclude<ReviewStatus, "unreviewed">;
export type QueueKind = "function" | "risk" | "unit";

export interface QueueItem {
  id: string;
  kind: QueueKind;
  /** FunctionStatus, RiskKind or UnitStatus, depending on `kind`. */
  status: string;
  /** Function-map status of a risk that sits on a mapped function (same finding). */
  secondary?: FunctionStatus;
  title: string;
  priority: number;
  /** false for «сохранена» / «добавлено»: nothing to decide unless the analyst wants to. */
  question: boolean;
  before: ClauseRef[];
  after: ClauseRef[];
  context: ClauseRef[];
  evidenceError?: string;
  fromUnits: string[];
  toUnits: string[];
  explanation?: string;
  recommendation?: string;
  search?: string;
  searchIncomplete: boolean;
  review: Review;
}

/** What a human must check first goes on top (product.md §3.5, SCENARIOS.md N). */
const PRIORITY: Record<string, number> = {
  "missing:incomplete": 0,
  missing: 1,
  conflict: 2,
  duplicate: 3,
  transferred: 4,
  split: 5,
  merged: 6,
  modality: 7,
  scope: 8,
  unclear: 9,
  reference: 10,
  reworded: 11,
  structure: 12,
  kept: 20,
  new: 21,
};

const UNREVIEWED: Review = { status: "unreviewed" };

export function buildQueue(result: AnalysisResult, overrides: Record<string, Review> = {}): QueueItem[] {
  const items = new Map<string, QueueItem>();
  for (const f of result.functions) {
    const ev = functionEvidence(f);
    const incomplete = f.status === "missing" && !!f.search && !f.search.complete;
    items.set(f.id, {
      id: f.id,
      kind: "function",
      status: f.status,
      title: f.title,
      priority: PRIORITY[incomplete ? "missing:incomplete" : f.status] ?? 15,
      question: f.status !== "kept" && f.status !== "new",
      before: ev.before ?? [],
      after: ev.after ?? [],
      context: ev.context ?? [],
      evidenceError: ev.error,
      fromUnits: f.before.map((s) => s.unit),
      toUnits: f.after.map((s) => s.unit),
      explanation: f.note,
      recommendation: f.recommendation,
      search: f.search?.text,
      searchIncomplete: incomplete,
      review: overrides[f.id] ?? f.review ?? UNREVIEWED,
    });
  }
  for (const r of result.risks) {
    const base = items.get(r.id);
    const ev = riskEvidence(r);
    const unitsOn = (side: "before" | "after") => r.sides.filter((s) => s.refs.some((ref) => ref.side === side)).map((s) => s.unit);
    const riskAfterUnits = unitsOn("after");
    items.set(r.id, {
      id: r.id,
      kind: "risk",
      status: r.kind,
      secondary: base?.status as FunctionStatus | undefined,
      title: r.title,
      priority: PRIORITY[r.kind] ?? 9,
      question: true,
      before: uniqueRefs([...(base?.before ?? []), ...(ev.before ?? [])]),
      after: uniqueRefs([...(ev.after ?? []), ...(base?.after ?? [])]),
      context: uniqueRefs([...(base?.context ?? []), ...(ev.context ?? [])]),
      evidenceError: ev.error ?? base?.evidenceError,
      fromUnits: base?.fromUnits.length ? base.fromUnits : unitsOn("before"),
      toUnits: riskAfterUnits.length ? riskAfterUnits : base?.toUnits ?? [],
      explanation: r.why,
      recommendation: r.check,
      search: base?.search,
      searchIncomplete: base?.searchIncomplete ?? false,
      review: overrides[r.id] ?? r.review ?? base?.review ?? UNREVIEWED,
    });
  }
  for (const s of result.structureFindings ?? []) {
    if (!s.finding_id || items.has(s.finding_id)) continue;
    items.set(s.finding_id, {
      id: s.finding_id,
      kind: "unit",
      status: s.status ?? "changed",
      title: s.title,
      priority: PRIORITY.structure,
      question: true,
      before: s.before ?? [],
      after: s.after ?? [],
      context: s.context ?? [],
      evidenceError: s.error,
      fromUnits: [],
      toUnits: [],
      explanation: s.note,
      recommendation: s.recommendation,
      searchIncomplete: false,
      review: overrides[s.finding_id] ?? s.review ?? UNREVIEWED,
    });
  }
  return [...items.values()].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, "ru"));
}

const SCOPES: ReviewScope[] = ["unreviewed", "all", "needs_clarification", "rejected", "confirmed"];

export function useReviewQueue(items: QueueItem[]) {
  const [params, setParams] = useSearchParams();
  const scope = (SCOPES as string[]).includes(params.get("review") ?? "") ? (params.get("review") as ReviewScope) : "unreviewed";
  const statuses = useMemo(() => new Set((params.get("status") ?? "").split(",").filter(Boolean)), [params]);
  const withQuiet = params.get("all") === "1";

  const visible = useMemo(
    () =>
      items
        .filter((i) => withQuiet || i.question || scope !== "unreviewed")
        .filter((i) => statuses.size === 0 || statuses.has(i.status))
        .filter((i) =>
          scope === "all" ? true : scope === "unreviewed" ? i.review.status === "unreviewed" : i.review.status === scope,
        ),
    [items, statuses, scope, withQuiet],
  );

  const questions = items.filter((i) => i.question);
  const reviewedCount = questions.filter((i) => i.review.status !== "unreviewed").length;
  const quietCount = items.length - questions.length;
  /** Status → chip kind, in queue order, for the filter row. */
  const presentStatuses = useMemo(() => {
    const kinds = new Map<string, QueueKind>();
    items.filter((i) => i.question || withQuiet).forEach((i) => kinds.has(i.status) || kinds.set(i.status, i.kind));
    return [...kinds].map(([status, kind]) => ({ status, kind }));
  }, [items, withQuiet]);

  const wanted = params.get("f");
  const selected = visible.find((i) => i.id === wanted) ?? visible[0];

  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => (v === null || v === "" ? next.delete(k) : next.set(k, v)));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const select = useCallback((id: string) => update({ f: id }), [update]);
  const setScope = useCallback((s: ReviewScope) => update({ review: s === "unreviewed" ? null : s, f: null }), [update]);
  const toggleStatus = useCallback(
    (s: string) => {
      const next = new Set(statuses);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      update({ status: [...next].join(",") || null, f: null });
    },
    [statuses, update],
  );
  const setWithQuiet = useCallback((on: boolean) => update({ all: on ? "1" : null }), [update]);
  const resetFilters = useCallback(() => update({ status: null, review: null, all: null, f: null }), [update]);

  const index = selected ? visible.findIndex((i) => i.id === selected.id) : -1;
  const step = useCallback(
    (delta: number) => {
      const target = visible[index + delta];
      if (target) select(target.id);
    },
    [visible, index, select],
  );

  /** The item to show after a decision: the next unreviewed one below, else the next one, else the previous. */
  const nextAfterDecision = useCallback((): string | undefined => {
    if (index < 0) return undefined;
    const below = visible.slice(index + 1);
    return (below.find((i) => i.review.status === "unreviewed") ?? below[0] ?? visible[index - 1])?.id;
  }, [visible, index]);

  return {
    visible,
    selected,
    index,
    scope,
    statuses,
    withQuiet,
    quietCount,
    presentStatuses,
    questionsCount: questions.length,
    reviewedCount,
    select,
    step,
    setScope,
    toggleStatus,
    setWithQuiet,
    resetFilters,
    nextAfterDecision,
  };
}
