import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyReviews } from "@/lib/demo";
import { buildHtml } from "@/lib/export";
import type { AnalysisResult } from "@/types";

const fixture = (): AnalysisResult => JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/demo/cases/demo-conflict.result.json"), "utf8"));

test("rejecting a demo finding removes its open conclusion item and preserves neutral/other items", () => {
  const base = fixture();
  const findingId = base.risks[0].id;
  base.conclusion.sections[0].items.push(
    { text: "Нейтральное пояснение", refs: [] },
    { finding_id: "other-finding", text: "Другой вопрос", refs: [] },
  );
  const result = applyReviews(base, { [findingId]: { status: "rejected", note: "Проверены разные условия" } });
  const open = result.conclusion.sections.find((s) => s.title === "Вопрос для проверки")!;
  assert.deepEqual(open.items.map((i) => i.text), ["Нейтральное пояснение", "Другой вопрос"]);
  const rejected = result.conclusion.sections.find((s) => s.title === "Отклонено при проверке")!;
  assert.equal(rejected.items.length, 1);
  assert.equal(rejected.items[0].finding_id, findingId);
  assert.match(rejected.items[0].text, /Проверены разные условия/);
  assert.equal(result.conclusion.sections.flatMap((s) => s.items).filter((i) => i.finding_id === findingId).length, 1);
  assert.equal(base.conclusion.sections[0].items.length, 3, "saved source is not mutated");
  assert.match(result.conclusion.sections[0].items[0].text, /исходные выводы/);
  assert.doesNotMatch(JSON.stringify(result.conclusion), /выводы ИИ/);
});

test("rejected synthetic conflict is absent from exported open questions and reset restores it", () => {
  const base = fixture();
  const id = base.risks[0].id;
  const rejected = applyReviews(base, { [id]: { status: "rejected", note: "Контрольная заметка" } });
  assert.ok(!rejected.conclusion.sections.some((s) => s.title === "Вопрос для проверки"));
  const html = buildHtml(rejected);
  assert.doesNotMatch(html, /<h3>Вопрос для проверки<\/h3>/);
  assert.match(html, /Отклонено при проверке/);
  assert.match(html, /Контрольная заметка/);
  const restored = applyReviews(base, {});
  assert.deepEqual(restored, base);
  assert.equal(restored.conclusion.sections[0].items[0].finding_id, id);
});

test("official cached conclusion links findings so each rejection removes only its own question in HTML", () => {
  const base: AnalysisResult = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/demo/result.json"), "utf8"));
  const neutral = base.conclusion.sections.find((section) => section.title === "Изменения структуры")!;
  assert.ok(neutral.items.every((item) => !item.finding_id));
  const linked = base.conclusion.sections.flatMap((section) => section.items).filter((item) => item.finding_id);
  const findingIds = new Set([...base.functions, ...base.risks].map((finding) => finding.id));
  assert.equal(linked.length, 7);
  assert.ok(linked.every((item) => findingIds.has(item.finding_id!)));
  for (const item of linked) {
    const result = applyReviews(base, { [item.finding_id!]: { status: "rejected", note: "Проверено вручную" } });
    const openItems = result.conclusion.sections.filter((section) => section.title !== "Отклонено при проверке").flatMap((section) => section.items);
    assert.ok(openItems.every((candidate) => candidate.finding_id !== item.finding_id));
    assert.ok(openItems.some((candidate) => candidate.text === neutral.items[0].text));
    const html = buildHtml(result);
    assert.ok(!html.includes(item.text), `Rejected baseline explanation still exported: ${item.finding_id}`);
    assert.match(html, /Отклонено при проверке/);
  }
  const missing = base.conclusion.sections.find((section) => section.title === "Вопросы для проверки")!.items;
  assert.deepEqual(missing.filter((item) => item.finding_id?.startsWith("f-")).map((item) => [item.finding_id, item.refs.map((ref) => ref.clause_number)]), [
    ["f-qa-groups", ["5.6.2"]],
    ["f-external-assessment", ["5.6.3"]],
  ]);
});
