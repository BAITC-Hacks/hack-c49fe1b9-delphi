import type {
  AnalysisResult,
  ApiChangeType,
  ApiDocument,
  ApiEvidence,
  ApiFinding,
  ApiIssueType,
  ApiRunDetail,
  ApiRunStage,
  ApiSearchCoverage,
  ApiSource,
  ApiStructureChange,
  ApiUnit,
  Clause,
  ClauseRef,
  ConclusionSection,
  FunctionMapping,
  FunctionSide,
  FunctionStatus,
  JobStatus,
  LiveBundle,
  Review,
  Risk,
  RiskKind,
  RiskSide,
  StageState,
  Unit,
  UnitStatus,
} from "@/types";
import { FUNCTION_STATUS, REVIEW_STATUS, RISK_KIND } from "@/lib/status";

/*
 * Maps the backend's granular API (backend/openapi.json) onto the UI contract in types.ts.
 * Enum tables follow docs/handoff.md §3.2, result assembly §3.3. Source text is never rewritten here:
 * every ClauseRef points at a saved source block, highlights are the backend's own excerpts.
 */

// ---- Run progress --------------------------------------------------------------------------------

/** Stepper stage (1–5, see AnalysisProgress.STAGES) for each backend stage. Parsing happens on upload. */
const STAGE_NUMBER: Record<ApiRunStage, JobStatus["stage"]> = {
  queued: 1,
  extracting: 2,
  comparing: 3,
  checking_risks: 4,
  validating: 5,
  completed: 5,
  partial: 5,
  failed: 5,
  interrupted: 5,
};

/** On failure the backend overwrites `stage` with the state, so the failed stage is inferred from coverage. */
function inferStoppedStage(run: ApiRunDetail): JobStatus["stage"] {
  const c = run.coverage;
  if (c.total_sources > 0 && c.processed_sources < c.total_sources) return 2;
  if (c.before_functions === 0 && c.after_functions === 0) return 2;
  if (c.compared_before_functions < c.before_functions) return 3;
  if (c.reviewed_after_functions < c.after_functions) return 4;
  return 5;
}

/** Run errors the backend writes in English (services/workflow.py, agent); other texts pass through. */
const RUN_ERRORS: [pattern: RegExp, text: string][] = [
  [/^Analysis exceeded RUN_TIMEOUT_SECONDS/, "Анализ превысил лимит времени сервера"],
  [/^Application (restarted before the run completed|stopped during the run)/, "Сервер перезапускался во время анализа"],
  [/^Analysis failed; inspect the server log/, "Анализ завершился ошибкой; подробности — в журнале сервера"],
  [/^Extraction \((before|after)\): /, "Извлечение функций ($1): "],
  [/^Function review \((before|after)\): /, "Сопоставление функций ($1): "],
  [/^Structure: /, "Сравнение структуры: "],
];

export function runError(message: string): string {
  for (const [pattern, text] of RUN_ERRORS) {
    if (pattern.test(message)) return message.replace(pattern, text).replace("(before)", "(«До»)").replace("(after)", "(«После»)");
  }
  return message;
}

export function toJobStatus(run: ApiRunDetail): JobStatus {
  const c = run.coverage;
  const finished = run.state === "completed" || run.state === "partial";
  const stageState: StageState =
    run.state === "queued" || run.state === "running"
      ? "running"
      : finished
        ? "done"
        : run.state === "interrupted"
          ? "interrupted"
          : "failed";
  const counters: Record<string, number> = {};
  if (c.total_sources) counters.clauses = c.processed_sources;
  if (c.total_sources && c.processed_sources < c.total_sources) counters.total = c.total_sources;
  if (c.structure_units) counters.units = c.structure_units;
  if (c.before_functions) counters.functions = c.before_functions;
  if (c.compared_before_functions) counters.matched = c.compared_before_functions;
  return {
    id: run.id,
    analysis_id: run.analysis_id,
    stage: stageState === "failed" || stageState === "interrupted" ? inferStoppedStage(run) : STAGE_NUMBER[run.stage],
    stage_state: stageState,
    counters,
    result_id: finished ? run.analysis_id : undefined,
    error: run.errors.length ? run.errors.map(runError).join("; ") : undefined,
    allow_partial: c.allow_partial,
  };
}

// ---- Documents and sources -----------------------------------------------------------------------

function stem(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Citation label per document: "ред. 9" when the parser found a revision number, else the file name.
 * If two documents would share a label (e.g. both mention "редакция 9"), both fall back to file names.
 */
export function editionLabels(documents: ApiDocument[]): Record<string, string> {
  const byRevision = new Map<string, number>();
  documents.forEach((d) => d.revision_label && byRevision.set(d.revision_label, (byRevision.get(d.revision_label) ?? 0) + 1));
  const labels: Record<string, string> = {};
  documents.forEach((d) => {
    labels[d.id] = d.revision_label && byRevision.get(d.revision_label) === 1 ? `ред. ${d.revision_label}` : stem(d.filename);
  });
  return labels;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function firstLine(text: string, max = 160): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Verbatim block → Clause for the evidence drawer. `parent` is the heading block, when there is one. */
export function toClause(source: ApiSource, edition: string, parent?: ApiSource): Clause {
  return {
    document_id: source.document_id,
    edition,
    clause_id: source.id,
    clause_number: source.clause_no ?? "",
    text: source.original_text,
    parent: parent ? firstLine(parent.original_text) : undefined,
  };
}

const WARNING_LABELS: [prefix: string, label: string][] = [
  ["table_of_contents_skipped", "оглавление пропущено"],
  ["docx_headers_footers_not_extracted", "колонтитулы не извлечены"],
  ["automatic_numbering_not_resolved", "автонумерация не распознана"],
  ["docx_body_element_not_extracted", "элемент документа не извлечён"],
  ["nested_tables_not_extracted", "вложенные таблицы не извлечены"],
  ["empty_clause", "пустой пункт"],
  ["missing_annex_content", "нет текста приложения"],
  ["pdf_page_without_text", "страница PDF без текстового слоя"],
  ["xlsx_formulas_not_evaluated", "формулы XLSX не вычислены"],
];

/** Parser warning codes → short Russian phrases with counts, e.g. "автонумерация не распознана ×3". */
export function describeWarnings(warnings: string[]): string[] {
  const counts = new Map<string, number>();
  warnings.forEach((w) => {
    const label = WARNING_LABELS.find(([p]) => w.startsWith(p))?.[1] ?? w.split(":")[0].replace(/_/g, " ");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
}

/** Warnings that are informational only (the backend does not count them as a parsing gap). */
export function isInformational(warning: string): boolean {
  return warning.startsWith("table_of_contents_skipped:");
}

// ---- Result assembly -----------------------------------------------------------------------------

const FUNCTION_OF: Record<ApiChangeType, FunctionStatus | null> = {
  retained: "kept",
  reworded: "reworded",
  transferred: "transferred",
  split: "split",
  merged: "merged",
  new: "new",
  potentially_missing: "missing",
  changed: "reworded",
  structure_changed: null, // shown in «Структура» and the conclusion, not in the function map
};

const RISK_OF: Record<ApiIssueType, RiskKind> = {
  overlap: "duplicate",
  potential_conflict: "conflict",
  modality_changed: "modality",
  scope_changed: "scope",
  insufficient_evidence: "unclear",
};

const UNIT_OF: Record<ApiStructureChange["status"], UnitStatus> = {
  retained: "kept",
  newly_listed: "new",
  transformed: "changed",
  unmatched: "missing",
};

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "Поиск по 14 пунктам комплекта «После», полный: да" (handoff §3.2, SearchCoverage). */
export function describeSearch(s: ApiSearchCoverage | null): string | undefined {
  if (!s) return undefined;
  const n = s.reviewed_source_ids.length;
  const scope = `Поиск по ${n} ${plural(n, "пункту", "пунктам", "пунктам")} комплекта «После»`;
  const candidates = s.candidate_source_ids.length
    ? ` Рассмотрено кандидатов: ${s.candidate_source_ids.length}.`
    : "";
  if (s.complete && !s.input_partial) return `${scope}, полный: да.${candidates}`;
  const why = s.input_partial ? " Часть текста «После» прочитана не полностью." : "";
  const errors = s.errors.length ? ` Ошибки поиска: ${s.errors.join("; ")}.` : "";
  return `${scope}, полный: нет — это неполная проверка, а не «не найдено».${why}${errors}${candidates}`;
}

function toReview(r: ApiFinding["review"]): Review {
  return { status: r.status, note: r.note || undefined, updated_at: r.updated_at };
}

function reviewSummary(findings: ApiFinding[]): string {
  const done = findings.filter((f) => f.review.status !== "unreviewed");
  if (!done.length) return "";
  const parts = (["confirmed", "needs_clarification", "rejected"] as const)
    .map((st) => [st, done.filter((f) => f.review.status === st).length] as const)
    .filter(([, n]) => n > 0)
    .map(([st, n]) => `${REVIEW_STATUS[st].label.toLowerCase()} — ${n}`);
  return ` Проверено человеком: ${done.length} из ${findings.length} (${parts.join(", ")}).`;
}

export function toAnalysisResult(b: LiveBundle): AnalysisResult {
  const { analysis, run } = b;
  const docs = analysis.documents;
  const docById = new Map(docs.map((d) => [d.id, d]));
  const labels = editionLabels(docs);
  const unitById = new Map<string, ApiUnit>(run.units.map((u) => [u.id, u]));
  const fnById = new Map(b.functions.map((f) => [f.id, f]));

  const refForSource = (sourceId: string, highlight?: string): ClauseRef => {
    const src = b.sources[sourceId];
    const doc = src ? docById.get(src.document_id) : undefined;
    return {
      document_id: src?.document_id ?? "",
      edition: doc ? labels[doc.id] : "источник",
      clause_id: sourceId,
      clause_number: src?.clause_no ?? "б/н",
      highlight,
      side: doc?.side,
    };
  };
  const refForEvidence = (e: ApiEvidence): ClauseRef => ({
    document_id: e.document_id,
    edition: labels[e.document_id] ?? stem(e.filename),
    clause_id: e.source_id,
    clause_number: e.clause_no ?? "б/н",
    highlight: e.excerpt || undefined,
    side: e.side,
  });
  const unitName = (ids: string[]): string | undefined =>
    ids.map((id) => unitById.get(id)?.name_original).find(Boolean);

  const evidenceRefs = (findingId: string) => {
    const ev = b.evidence[findingId] ?? [];
    return {
      all: ev,
      before: ev.filter((e) => e.evidence_role === "before").map(refForEvidence),
      after: ev.filter((e) => e.evidence_role === "after").map(refForEvidence),
    };
  };

  /** Function → table side. The citation prefers the finding's evidence (it carries the excerpt). */
  const functionSide = (fnId: string, ev: ApiEvidence[]): FunctionSide | undefined => {
    const fn = fnById.get(fnId);
    if (!fn) return undefined;
    const hit = ev.find((e) => fn.source_ids.includes(e.source_id));
    const ref = hit ? refForEvidence(hit) : fn.source_ids[0] ? refForSource(fn.source_ids[0]) : undefined;
    if (!ref) return undefined;
    return {
      unit: unitName(fn.owner_unit_ids) ?? (fn.actor_original || "Исполнитель не указан"),
      ref,
      summary: capitalize([fn.action, fn.object, fn.scope].filter(Boolean).join(" ")),
    };
  };

  // Units: one row per structure change; roles are not departments (product.md §3.4).
  const units: Unit[] = run.structure
    .map((s): Unit | null => {
      const before = s.before_unit_ids.map((id) => unitById.get(id)).filter((u): u is ApiUnit => !!u);
      const after = s.after_unit_ids.map((id) => unitById.get(id)).filter((u): u is ApiUnit => !!u);
      const all = [...before, ...after];
      if (all.length > 0 && all.every((u) => u.kind === "role")) return null;
      const status = UNIT_OF[s.status];
      const shown = (status === "missing" ? before : after)[0] ?? all[0];
      const beforeName = before.map((u) => u.name_original).join(", ");
      const afterName = after.map((u) => u.name_original).join(", ");
      const name =
        status === "changed" && beforeName && afterName && beforeName !== afterName
          ? `${beforeName} → ${afterName}`
          : shown?.name_original ?? (afterName || beforeName || "Подразделение");
      const parent = shown?.parent_unit_id ? unitById.get(shown.parent_unit_id)?.name_original : undefined;
      const sideRef = (list: ApiUnit[], side: "before" | "after") => {
        const id = list.flatMap((u) => u.source_ids)[0] ?? s.source_ids.find((sid) => refForSource(sid).side === side);
        return id ? refForSource(id, list[0]?.name_original) : undefined;
      };
      return {
        unit_id: s.id,
        name,
        status,
        parent,
        before: sideRef(before, "before"),
        after: sideRef(after, "after"),
        note: s.explanation || undefined,
      };
    })
    .filter((u): u is Unit => !!u);

  // Functions: every finding except pure structure changes. A finding with an issue is also a risk card.
  const functions: FunctionMapping[] = [];
  for (const f of b.findings) {
    const status = FUNCTION_OF[f.change_type];
    if (!status) continue;
    const ev = evidenceRefs(f.id);
    const before = f.before_function_ids.map((id) => functionSide(id, ev.all)).find(Boolean);
    const after = f.after_function_ids
      .map((id) => functionSide(id, ev.all))
      .filter((s): s is FunctionSide => !!s);
    const search = f.change_type === "potentially_missing" ? describeSearch(f.search) : undefined;
    functions.push({
      id: f.id,
      title: f.title,
      status,
      before:
        before ??
        (ev.before[0] ? { unit: "Исполнитель не указан", ref: ev.before[0], summary: f.title } : undefined),
      after: after.length
        ? after
        : status === "missing"
          ? []
          : ev.after.map((ref) => ({ unit: "Исполнитель не указан", ref, summary: f.title })),
      note: [f.explanation, search && !search.includes("полный: да") ? search : undefined].filter(Boolean).join(" ") || undefined,
      recommendation: f.recommendation || undefined,
      review: toReview(f.review),
      search,
    });
  }

  // Risks: findings with an issue type. Sides are the functions involved, else the evidence.
  const risks: Risk[] = [];
  for (const f of b.findings) {
    if (!f.issue_type) continue;
    const ev = evidenceRefs(f.id);
    // Overlaps and conflicts are between After functions (the backend requires two of them);
    // modality/scope changes compare Before with After.
    const between = f.issue_type === "overlap" || f.issue_type === "potential_conflict";
    const order = between && f.after_function_ids.length >= 2 ? f.after_function_ids : [...f.before_function_ids, ...f.after_function_ids];
    const sides: RiskSide[] = order
      .map((id) => functionSide(id, ev.all))
      .filter((s): s is FunctionSide => !!s);
    if (sides.length < 2) {
      [...ev.before, ...ev.after]
        .filter((ref) => !sides.some((s) => s.ref.clause_id === ref.clause_id))
        .forEach((ref) => sides.push({ unit: "Исполнитель не указан", ref }));
    }
    if (sides.length === 0) continue;
    risks.push({
      id: f.id,
      kind: RISK_OF[f.issue_type],
      title: f.title,
      a: sides[0],
      b: sides[1] ?? sides[0],
      why: f.explanation,
      check: f.recommendation,
      review: toReview(f.review),
    });
  }

  // Conclusion: built from the same saved findings, so the screen and the export never disagree.
  // Human review shapes it (scenario H): rejected findings leave the main sections, questions get their own.
  const isRejected = (r?: Review) => r?.status === "rejected";
  const withReview = (text: string, r?: Review) =>
    r?.status === "confirmed" ? `${text} — подтверждено проверяющим${r.note ? `: ${r.note}` : ""}.` : text;
  const sections: ConclusionSection[] = [];
  const counts = new Map<FunctionStatus, number>();
  functions.forEach((f) => counts.set(f.status, (counts.get(f.status) ?? 0) + 1));
  const countText = [...counts]
    .map(([st, n]) => `${FUNCTION_STATUS[st].label.toLowerCase()} — ${n}`)
    .join(", ");
  sections.push({
    title: "Итог сравнения",
    items: [
      {
        text:
          `Проанализировано функций «До»: ${run.coverage.before_functions}, «После»: ${run.coverage.after_functions}. ` +
          (countText ? `Результат по функциям: ${countText}. ` : "") +
          `Вопросов для проверки: ${risks.length}.` +
          reviewSummary(b.findings),
        refs: [],
      },
    ],
  });
  const refsOf = (f: FunctionMapping) => [...(f.before ? [f.before.ref] : []), ...(f.after ?? []).map((a) => a.ref)];
  const group = (title: string, statuses: FunctionStatus[]) => {
    const items = functions
      .filter((f) => statuses.includes(f.status) && !isRejected(f.review))
      .map((f) => ({ text: withReview([f.title, f.note].filter(Boolean).join(". "), f.review), refs: refsOf(f) }));
    if (items.length) sections.push({ title, items });
  };
  group("Функции без найденного соответствия", ["missing"]);
  group("Переданные, разделённые и объединённые функции", ["transferred", "split", "merged"]);
  group("Новые функции", ["new"]);
  const riskRefs = (r: Risk) => (r.a.ref.clause_id === r.b.ref.clause_id ? [r.a.ref] : [r.a.ref, r.b.ref]);
  const openRisks = risks.filter((r) => !isRejected(r.review));
  if (openRisks.length) {
    sections.push({
      title: "Вопросы для проверки",
      items: openRisks.map((r) => ({
        text: withReview(`${RISK_KIND[r.kind].label}: ${r.title}. ${r.check}`.trim(), r.review),
        refs: riskRefs(r),
      })),
    });
  }
  // One entry per finding even when it is both a function row and a risk card.
  const byFinding = new Map<string, { title: string; review?: Review; refs: ClauseRef[] }>();
  functions.forEach((f) => byFinding.set(f.id, { title: f.title, review: f.review, refs: refsOf(f) }));
  risks.forEach((r) => byFinding.has(r.id) || byFinding.set(r.id, { title: r.title, review: r.review, refs: riskRefs(r) }));
  const reviewed = (status: "needs_clarification" | "rejected", title: string, noteLabel: string) => {
    const items = [...byFinding.values()]
      .filter((x) => x.review?.status === status)
      .map((x) => ({ text: x.review?.note ? `${x.title}. ${noteLabel}: ${x.review.note}` : x.title, refs: x.refs }));
    if (items.length) sections.push({ title, items });
  };
  reviewed("needs_clarification", "Вопросы без окончательной проверки", "Заметка проверяющего");
  reviewed("rejected", "Отклонено при проверке", "Причина");
  const structureItems = [
    ...units
      .filter((u) => u.status !== "kept")
      .map((u) => ({ text: [u.name, u.note].filter(Boolean).join(": "), refs: [u.before, u.after].filter((r): r is ClauseRef => !!r) })),
    ...b.findings
      .filter((f) => f.change_type === "structure_changed")
      .map((f) => ({ text: [f.title, f.explanation].filter(Boolean).join(": "), refs: f.source_ids.map((id) => refForSource(id)) })),
  ];
  if (structureItems.length) sections.push({ title: "Изменения структуры", items: structureItems });

  // Limitations: what the run could not cover, straight from RunCoverage and the saved errors.
  const c = run.coverage;
  const before = docs.filter((d) => d.side === "before");
  const after = docs.filter((d) => d.side === "after");
  const limitations: string[] = [
    `Анализ ограничен предоставленными документами: «До» — ${before.map((d) => d.filename).join(", ")}; «После» — ${after
      .map((d) => d.filename)
      .join(", ")}.`,
  ];
  if (c.input_partial) {
    docs
      .filter((d) => d.warnings.some((w) => !isInformational(w)))
      .forEach((d) =>
        limitations.push(
          `${d.filename}: текст прочитан не полностью (${describeWarnings(d.warnings.filter((w) => !isInformational(w))).join(", ")}). Анализ запущен в ограниченном режиме.`,
        ),
      );
  }
  if (c.unprocessed_source_ids.length) {
    limitations.push(`Не обработано пунктов: ${c.unprocessed_source_ids.length} из ${c.total_sources}.`);
  }
  if (c.unreviewed_function_ids.length) {
    limitations.push(`Функций «После» не проверено при сопоставлении: ${c.unreviewed_function_ids.length} из ${c.after_functions}.`);
  }
  const incomplete = b.findings.filter((f) => f.change_type === "potentially_missing" && f.search && !f.search.complete).length;
  if (incomplete) {
    limitations.push(
      `Для ${incomplete} ${plural(incomplete, "функции", "функций", "функций")} без соответствия поиск по комплекту «После» неполный — требуется ручная проверка.`,
    );
  }
  run.errors.forEach((e) => limitations.push(`Ошибка при выполнении: ${runError(e)}`));
  limitations.push(
    `Выводы сформированы моделью ${run.model || "—"} (конвейер ${run.pipeline_version || "—"}), ссылки на пункты проверены по сохранённым текстам документов.`,
  );

  const sideLabel = (list: ApiDocument[]) => {
    if (list.length === 0) return "—";
    if (list.length <= 2) return list.map((d) => labels[d.id]).join(" + ");
    return `${list.length} ${plural(list.length, "документ", "документа", "документов")}`;
  };

  const partial = run.state === "partial";
  return {
    id: analysis.id,
    mode: partial ? "partial" : "live",
    editions: { before: { label: sideLabel(before) }, after: { label: sideLabel(after) } },
    units,
    functions,
    risks,
    conclusion: { sections, limitations },
    trace: [], // the backend does not expose tool calls; search coverage is shown per finding instead
    partial: partial
      ? {
          failed_stage: c.unprocessed_source_ids.length ? 2 : c.unreviewed_function_ids.length ? 3 : 0,
          message: run.errors.map(runError).join("; ") || (c.input_partial ? "часть текста документов прочитана не полностью" : "не все данные обработаны"),
        }
      : undefined,
    live: { analysis_id: analysis.id, run_id: run.id, review_revision: run.review_revision },
  };
}
