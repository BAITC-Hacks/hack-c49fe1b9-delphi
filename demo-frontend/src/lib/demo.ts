import { functionEvidence, refsOfSides } from "@/lib/evidence";
import { REVIEW_STATUS } from "@/lib/status";
import type { AnalysisResult, ClauseRef, ConclusionSection, Review, ReviewStatus } from "@/types";

/**
 * Demo build (team decision): the app runs on saved example results, without a backend.
 * The live API path in lib/api.ts stays available behind VITE_LIVE_API=1 for later phases.
 */
export const DEMO_ONLY = (import.meta.env.VITE_LIVE_API as string | undefined) !== "1";

export interface DemoCase {
  id: string;
  title: string;
  kind: "official" | "synthetic";
  /** What the example demonstrates, in one line. */
  shows: string;
  before: string[];
  after: string[];
  created_at: string;
}

export const DEMO_CASES: DemoCase[] = [
  {
    id: "demo",
    title: "Положение о внутреннем аудите: редакция 8 → редакция 9",
    kind: "official",
    shows: "Передача функций между исполнителями, новые подразделения, изменение обязательности, возможные дублирования",
    before: ["Положение_о_внутреннем_аудите_редакция_8_обезличено.docx"],
    after: ["Положение_о_внутреннем_аудите_редакция_9_обезличено.docx"],
    created_at: "2026-09-23T15:20:00+05:00",
  },
  {
    id: "demo-transfer",
    title: "Контрольный пример: функция перешла в другой документ",
    kind: "synthetic",
    shows: "Обязанность Отдела аудита найдена у Службы рисков во втором файле «После» — это передача, а не потеря",
    before: ["before.md"],
    after: ["after-audit.md", "after-risk.md"],
    created_at: "2026-09-23T16:10:00+05:00",
  },
  {
    id: "demo-missing",
    title: "Контрольный пример: соответствие не найдено",
    kind: "synthetic",
    shows: "Поиск по всему комплекту «После» не нашёл обязанность — вывод осторожный и требует проверки",
    before: ["before.md"],
    after: ["after.md"],
    created_at: "2026-09-23T16:10:00+05:00",
  },
  {
    id: "demo-overlap",
    title: "Контрольный пример: дублирование ответственности",
    kind: "synthetic",
    shows: "Два подразделения названы единственным ответственным за одну проверку",
    before: ["before.md"],
    after: ["after.md"],
    created_at: "2026-09-23T16:10:00+05:00",
  },
  {
    id: "demo-conflict",
    title: "Контрольный пример: возможный конфликт инструкций",
    kind: "synthetic",
    shows: "Казначейство обязано платить до согласования, Служба рисков обязана это запрещать",
    before: ["before.md"],
    after: ["after.md"],
    created_at: "2026-09-23T16:10:00+05:00",
  },
];

export const demoCase = (id: string) => DEMO_CASES.find((c) => c.id === id);
export const isDemoId = (id: string) => !!demoCase(id);

export function demoFiles(id: string) {
  return id === "demo"
    ? { result: "/demo/result.json", clauses: "/demo/clauses.json" }
    : { result: `/demo/cases/${id}.result.json`, clauses: `/demo/cases/${id}.clauses.json` };
}

// ---- Human review in the demo: kept in this browser only ------------------------------------------

const storageKey = (id: string) => `delphi.demo.reviews.${id}`;

export function loadDemoReviews(id: string): Record<string, Review> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id)) ?? "{}") as Record<string, Review>;
  } catch {
    return {};
  }
}

export function storeDemoReview(id: string, findingId: string, review: Review): Record<string, Review> {
  const all = loadDemoReviews(id);
  if (review.status === "unreviewed" && !review.note) delete all[findingId];
  else all[findingId] = review;
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(all));
  } catch {
    /* private mode: decisions still apply until reload */
  }
  return all;
}

export function clearDemoReviews(id: string) {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    /* nothing stored */
  }
}

/**
 * Applies the analyst's decisions to a saved example. Rows and cards get the review; the conclusion gets
 * a review summary, «Вопросы без окончательной проверки» and «Отклонено при проверке» (scenario H).
 */
export function applyReviews(base: AnalysisResult, reviews: Record<string, Review>): AnalysisResult {
  if (!Object.keys(reviews).length) return base;
  const pick = <T extends { id: string; review?: Review }>(x: T): T => (reviews[x.id] ? { ...x, review: reviews[x.id] } : x);
  const functions = base.functions.map(pick);
  const risks = base.risks.map(pick);

  const findings = new Map<string, { title: string; refs: ClauseRef[] }>();
  functions.forEach((f) => {
    const ev = functionEvidence(f);
    findings.set(f.id, { title: f.title, refs: [...(ev.before ?? []), ...(ev.after ?? [])] });
  });
  risks.forEach((r) => findings.has(r.id) || findings.set(r.id, { title: r.title, refs: refsOfSides(r.sides) }));

  // Same count as the review queue: «сохранена» / «добавлено» are not questions.
  const quiet = new Set(functions.filter((f) => (f.status === "kept" || f.status === "new") && !risks.some((r) => r.id === f.id)).map((f) => f.id));
  const questions = findings.size - quiet.size;
  const decided = Object.entries(reviews).filter(([id, r]) => findings.has(id) && r.status !== "unreviewed");
  const count = (st: ReviewStatus) => decided.filter(([, r]) => r.status === st).length;
  const summary = (["confirmed", "needs_clarification", "rejected"] as const)
    .filter((st) => count(st) > 0)
    .map((st) => `${REVIEW_STATUS[st].label.toLowerCase()} — ${count(st)}`)
    .join(", ");

  const listOf = (st: ReviewStatus, noteLabel: string) =>
    decided
      .filter(([, r]) => r.status === st)
      .map(([id, r]) => {
        const f = findings.get(id)!;
        return { finding_id: id, text: r.note ? `${f.title}. ${noteLabel}: ${r.note}` : f.title, refs: f.refs };
      });

  const sections: ConclusionSection[] = [];
  if (decided.length) {
    sections.push({
      title: "Проверка человеком",
      items: [{ text: `Проверено вопросов: ${decided.filter(([id]) => !quiet.has(id)).length} из ${questions} (${summary}). Решения не меняют исходные выводы.`, refs: [] }],
    });
  }
  const confirmed = listOf("confirmed", "Комментарий");
  if (confirmed.length) sections.push({ title: "Подтверждено проверяющим", items: confirmed });
  const rejectedIds = new Set(decided.filter(([, r]) => r.status === "rejected").map(([id]) => id));
  sections.push(...base.conclusion.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.finding_id || !rejectedIds.has(item.finding_id)),
    }))
    .filter((section) => section.items.length > 0));
  const open = listOf("needs_clarification", "Заметка проверяющего");
  if (open.length) sections.push({ title: "Вопросы без окончательной проверки", items: open });
  const rejected = listOf("rejected", "Причина");
  if (rejected.length) sections.push({ title: "Отклонено при проверке", items: rejected });

  return { ...base, functions, risks, conclusion: { ...base.conclusion, sections } };
}
