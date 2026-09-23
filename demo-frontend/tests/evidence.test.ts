import test from "node:test";
import assert from "node:assert/strict";
import { toAnalysisResult } from "@/lib/adapter";
import { locateEvidence } from "@/lib/highlight";
import { functionEvidence, riskEvidence, reviewQueue, riskSummary, uniqueRefs } from "@/lib/evidence";
import { buildHtml, buildCsv } from "@/lib/export";
import { loadLiveBundle, deleteDocument } from "@/lib/api";
import type { LiveBundle, ApiFinding, ApiCoverage, ApiEvidence } from "@/types";

function fixture(): LiveBundle {
  const coverage: ApiCoverage = { allow_partial: false, input_partial: false, input_warnings: {}, total_documents: 2, total_sources: 7, processed_sources: 7, before_functions: 2, compared_before_functions: 2, after_functions: 3, reviewed_after_functions: 3, structure_units: 2, reviewed_structure_units: 2, unprocessed_source_ids: [], unreviewed_function_ids: [] };
  const sources = Object.fromEntries(["b1", "b2", "bextra", "a1", "a2", "a3", "ctx"].map((id) => [id, { id, document_id: id.startsWith("b") ? "before" : "after", clause_no: id, parent_id: null, original_text: `Текст ${id}`, locator: {} }]));
  const finding: ApiFinding = { id: "merge", run_id: "run", title: "Объединение", change_type: "merged", issue_type: null, before_function_ids: ["b1", "b2"], after_function_ids: ["a1"], explanation: "Объединены две функции", recommendation: "Сверить исполнителей", source_ids: ["b1", "b2", "bextra", "a1", "ctx"], search: null, review: { finding_id: "merge", status: "unreviewed", note: "", updated_at: "" } };
  const risk: ApiFinding = { ...finding, id: "overlap", title: "Пересечение", change_type: "new", issue_type: "overlap", before_function_ids: [], after_function_ids: ["a1", "a2", "a3"], source_ids: ["a1", "a2", "a3"], review: { finding_id: "overlap", status: "rejected", note: "Разные области ответственности", updated_at: "" } };
  const evidence = (ids: string[]): ApiEvidence[] => ids.map((id) => ({ source_id: id, document_id: sources[id].document_id, filename: `${sources[id].document_id}.md`, side: sources[id].document_id as "before" | "after", clause_no: id, original_text: sources[id].original_text, excerpt: sources[id].original_text, locator: {}, evidence_role: id === "ctx" ? "context" : sources[id].document_id as "before" | "after", start_offset: 0, end_offset: sources[id].original_text.length }));
  const run = { id: "run", analysis_id: "analysis", state: "completed" as const, stage: "completed" as const, output_language: "ru" as const, model: "test", pipeline_version: "test", review_revision: 1, coverage, structure: [], errors: [], created_at: "", started_at: "", finished_at: "", units: ["u1", "u2"].map((id) => ({ id, side: "before" as const, kind: "department" as const, name_original: id === "u1" ? "Исполнитель A" : "Исполнитель B", parent_unit_id: null, source_ids: ["b1"] })), finding_count: 2 };
  return { analysis: { id: "analysis", title: "Test", created_at: "", documents: ["before", "after"].map((side) => ({ id: side, analysis_id: "analysis", side: side as "before" | "after", filename: `${side}.md`, hash: side, revision_label: null, format: "md", detected_language: "ru", parse_status: "parsed", warnings: [], created_at: "", block_count: 4 })), run }, run, findings: [finding, risk], functions: ["b1", "b2", "a1", "a2", "a3"].map((id) => ({ id, run_id: "run", side: id.startsWith("b") ? "before" : "after", owner_unit_ids: ["u1", "u2"], actor_original: "", action: "проверяет", object: id, scope: "все", condition: "", modality: "обязан", source_ids: id === "b1" ? [id, "bextra"] : [id] })), sources, evidence: { merge: evidence(finding.source_ids), overlap: evidence(risk.source_ids) } };
}

test("merged mapping retains every before function, owner and source", () => {
  const r = toAnalysisResult(fixture()); const f = r.functions[0];
  assert.equal(f.before.length, 2); assert.equal(f.before[0].refs.length, 2);
  assert.equal(f.before[0].unit, "Исполнитель A; Исполнитель B");
  assert.deepEqual(functionEvidence(f).before?.map((r) => r.clause_id), ["b1", "bextra", "b2"]);
});
test("context evidence and offsets survive the adapter", () => {
  const ev = functionEvidence(toAnalysisResult(fixture()).functions[0]);
  assert.equal(ev.context?.[0].clause_id, "ctx"); assert.equal(ev.context?.[0].start_offset, 0);
  assert.equal(ev.context?.[0].end_offset, 9);
});
test("search coverage is structured and rejects errors and partial input", () => {
  const b = fixture(); const f = b.findings[0];
  f.change_type = "potentially_missing"; f.after_function_ids = [];
  f.search = { method: "full", complete: true, reviewed_source_ids: ["a1", "a2"], candidate_source_ids: ["a1"], errors: [] };
  let search = toAnalysisResult(b).functions[0].search!;
  assert.equal(search.complete, true); assert.equal(search.reviewed, 2); assert.equal(search.candidates, 1);
  f.search.errors = ["source unavailable"];
  search = toAnalysisResult(b).functions[0].search!;
  assert.equal(search.complete, false); assert.match(search.text, /полный: нет/);
  f.search.errors = []; b.run.coverage.input_partial = true;
  assert.equal(toAnalysisResult(b).functions[0].search?.complete, false);
  f.search = null;
  assert.equal(toAnalysisResult(b).functions[0].search?.complete, false);
});
test("three-way overlap retains all participants, all in After", () => {
  const r = toAnalysisResult(fixture()).risks[0]; const ev = riskEvidence(r);
  assert.equal(r.sides.length, 3); assert.equal(ev.after?.length, 3); assert.deepEqual(ev.before, []);
});
test("same finding in risk and function maps counts as one decision", () => {
  assert.equal(reviewQueue(toAnalysisResult(fixture())).length, 2);
});
test("offsets select second identical excerpt after an astral Unicode character", () => {
  const text = "😀 цитата и цитата";
  const range = locateEvidence(text, { start_offset: 11, end_offset: 17, highlight: "цитата" });
  assert.deepEqual(range, { start: 12, end: 18 });
  assert.equal(text.slice(12, 18), "цитата");
});
test("bad offsets do not silently fall back to another occurrence", () => {
  assert.deepEqual(locateEvidence("цитата цитата", { start_offset: 99, end_offset: 105, highlight: "цитата" }), { invalid: true });
  assert.equal(locateEvidence("цитата цитата", { highlight: "цитата" }), null);
  assert.deepEqual(locateEvidence("А\n  Б", { highlight: "а б" }), { start: 0, end: 5 });
});
test("equal excerpts at distinct offsets are not deduplicated", () => {
  const ref = { document_id: "doc", edition: "ed", clause_id: "source", clause_number: "1", highlight: "цитата", start_offset: 0, end_offset: 6 };
  assert.equal(uniqueRefs([ref, { ...ref, start_offset: 7, end_offset: 13 }]).length, 2);
});
test("incomplete coverage never produces a complete no-risk assurance", () => {
  const b = fixture(); b.findings = []; b.run.coverage.input_partial = true;
  assert.match(riskSummary(toAnalysisResult(b)), /Полнота проверки не подтверждена/);
  b.run.coverage.input_partial = false;
  assert.match(riskSummary(toAnalysisResult(b)), /В проверенном комплекте/);
});
test("rejected risk, reviewer note and all before sources survive exports", () => {
  const r = toAnalysisResult(fixture()); const html = buildHtml(r);
  const open = html.slice(html.indexOf("<h3>Не проверено"), html.indexOf("<h3>Отклонено"));
  assert.doesNotMatch(open, /<strong>Пересечение/);
  assert.match(html, /Разные области ответственности/);
  assert.match(html, /bextra/); assert.match(buildCsv(r), /bextra/); assert.match(buildCsv(r), /b2/);
});
test("source and review text is escaped in HTML, formulas neutralized in CSV", () => {
  const r = toAnalysisResult(fixture()); r.functions[0].title = '<script>alert(1)</script>'; r.functions[0].review = { status: "confirmed", note: "=HYPERLINK(1)" };
  assert.doesNotMatch(buildHtml(r), /<script>/); assert.match(buildCsv(r), /'=HYPERLINK/);
});
test("unknown source IDs fail instead of fabricating a citation", () => {
  const b = fixture(); b.functions[0].source_ids.push("unknown");
  assert.throws(() => toAnalysisResult(b), /Не найден исходный фрагмент/);
});
test("evidence network failure is preserved and a subsequent load recovers", async () => {
  const b = fixture(); const originalFetch = globalThis.fetch; let fail = true;
  globalThis.fetch = async (input) => {
    const url = String(input); let data: unknown;
    if (url.endsWith("/analyses/analysis")) data = b.analysis;
    else if (url.endsWith("/runs/run")) data = b.run;
    else if (url.endsWith("/findings")) data = b.findings;
    else if (url.endsWith("/functions")) data = b.functions;
    else if (url.endsWith("/sources")) data = Object.values(b.sources).filter((s) => url.includes(`/documents/${s.document_id}/`));
    else if (url.endsWith("/evidence")) { if (fail) return new Response("{}", { status: 503 }); data = b.evidence[url.includes("/merge/") ? "merge" : "overlap"]; }
    else throw new Error(`Unexpected URL ${url}`);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  try {
    const first = await loadLiveBundle("analysis");
    assert.ok(first.evidenceErrors?.merge); assert.ok(functionEvidence(toAnalysisResult(first).functions[0]).error);
    fail = false; const second = await loadLiveBundle("analysis");
    assert.deepEqual(second.evidenceErrors, {}); assert.equal(second.evidence.merge.length, 5);
  } finally { globalThis.fetch = originalFetch; }
});
test("failed document removal remains an error; an already removed document is safe to retry", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: "unavailable", message: "Unavailable" }), { status: 503 });
    await assert.rejects(deleteDocument("analysis", "document"));
    globalThis.fetch = async () => new Response(JSON.stringify({ code: "document_not_found", message: "Document not found" }), { status: 404 });
    await assert.doesNotReject(deleteDocument("analysis", "document"));
    globalThis.fetch = async () => new Response(JSON.stringify({ code: "analysis_not_found", message: "Analysis not found" }), { status: 404 });
    await assert.rejects(deleteDocument("analysis", "document"));
  } finally { globalThis.fetch = originalFetch; }
});
