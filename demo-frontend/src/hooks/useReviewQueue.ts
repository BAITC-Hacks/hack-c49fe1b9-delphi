import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { AnalysisResult, ClauseRef, FunctionStatus, Review, ReviewStatus, RiskKind, RiskSide } from "@/types";

/**
 * Review queue (main screen): every finding a human has to decide on, most urgent first.
 * One item per finding — a finding that is both a function row and a risk card appears once, as the risk.
 * Filter, review scope and the selected item live in the URL, so reload and deep links keep the place.
 */

export type QueueStatus = FunctionStatus | RiskKind;
export type ReviewScope = "unreviewed" | "all" | Exclude<ReviewStatus, "unreviewed">;

export interface QueueItem {
  id: string;
  kind: "function" | "risk";
  status: QueueStatus;
  /** Function-map status of a risk that sits on a mapped function (same finding). */
  secondary?: FunctionStatus;
  title: string;
  priority: number;
  /** false for «сохранена» / «добавлено»: nothing to decide unless the analyst wants to. */
  question: boolean;
  before: ClauseRef[];
  after: ClauseRef[];
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
  kept: 20,
  new: 21,
};

const UNREVIEWED: Review = { status: "unreviewed" };

export function buildQueue(result: AnalysisResult, overrides: Record<string, Review> = {}): QueueItem[] {
  // Side of a reference without an explicit side (offline demo): by the documents the function map uses.
  const beforeDocs = new Set(result.functions.flatMap((f) => (f.before ? [f.before.ref.document_id] : [])));
  const sideOf = (ref: ClauseRef, fallback: "before" | "after") =>
    ref.side ?? (beforeDocs.has(ref.document_id) ? "before" : beforeDocs.size ? "after" : fallback);

  const items = new Map<string, QueueItem>();
  for (const f of result.functions) {
    const incomplete = f.status === "missing" && !!f.search && !f.search.includes("полный: да");
    items.set(f.id, {
      id: f.id,
      kind: "function",
      status: f.status,
      title: f.title,
      priority: PRIORITY[incomplete ? "missing:incomplete" : f.status] ?? 15,
      question: f.status !== "kept" && f.status !== "new",
      before: f.before ? [f.before.ref] : [],
      after: (f.after ?? []).map((a) => a.ref),
      fromUnits: f.before ? [f.before.unit] : [],
      toUnits: (f.after ?? []).map((a) => a.unit),
      explanation: f.note,
      recommendation: f.recommendation,
      search: f.search,
      searchIncomplete: incomplete,
      review: overrides[f.id] ?? f.review ?? UNREVIEWED,
    });
  }
  for (const r of result.risks) {
    const base = items.get(r.id);
    const sides: RiskSide[] = r.a.ref.clause_id === r.b.ref.clause_id ? [r.a] : [r.a, r.b];
    const riskBefore = sides.filter((s, i) => sideOf(s.ref, i === 0 ? "before" : "after") === "before");
    const riskAfter = sides.filter((s, i) => sideOf(s.ref, i === 0 ? "before" : "after") === "after");
    const unique = (refs: ClauseRef[]) => refs.filter((x, i) => refs.findIndex((y) => y.clause_id === x.clause_id) === i);
    items.set(r.id, {
      id: r.id,
      kind: "risk",
      status: r.kind,
      secondary: base?.status as FunctionStatus | undefined,
      title: r.title,
      priority: PRIORITY[r.kind] ?? 9,
      question: true,
      before: unique([...(base?.before ?? []), ...riskBefore.map((s) => s.ref)]),
      after: unique(riskAfter.map((s) => s.ref)),
      fromUnits: base?.fromUnits.length ? base.fromUnits : riskBefore.map((s) => s.unit),
      toUnits: riskAfter.map((s) => s.unit),
      explanation: r.why,
      recommendation: r.check,
      search: base?.search,
      searchIncomplete: base?.searchIncomplete ?? false,
      review: overrides[r.id] ?? r.review ?? base?.review ?? UNREVIEWED,
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
  const presentStatuses = useMemo(() => [...new Set(items.filter((i) => i.question || withQuiet).map((i) => i.status))], [items, withQuiet]);

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
