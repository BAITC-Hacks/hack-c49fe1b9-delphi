import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clauseExcerptRange } from "@/components/ClauseFragment";
import { locateEvidence } from "@/lib/highlight";
import type { Clause, ClauseRef } from "@/types";

const demo = path.resolve("public/demo");
const clauses: Record<string, Clause> = JSON.parse(fs.readFileSync(path.join(demo, "clauses.json"), "utf8"));

test("cached source clauses retain every original paragraph and subparagraph", () => {
  const sources = path.resolve("../docs/sources");
  for (const [key, clause] of Object.entries(clauses)) {
    const edition = clause.document_id === "ed8" ? 8 : 9;
    const filename = fs.readdirSync(sources).find((file) => file.includes(`редакция_${edition}_`) && file.endsWith(".md"));
    assert.ok(filename, key);
    const original = fs.readFileSync(path.join(sources, filename), "utf8");
    const number = clause.clause_number.replaceAll(".", "\\.");
    // Use the next numbered clause as the boundary, retaining all lettered subparagraphs.
    const block = original.match(new RegExp(`^${number}\\. ([\\s\\S]*?)(?=^\\d+(?:\\.\\d+)+\\. |(?![\\s\\S]))`, "m"));
    assert.ok(block, key);
    const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
    assert.equal(normalized(clause.text), normalized(block[1]), key);
  }
});

test("all cached demo references resolve and every evidence quote remains unique", () => {
  const result = JSON.parse(fs.readFileSync(path.join(demo, "result.json"), "utf8"));
  let count = 0;
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const item = value as Record<string, unknown>;
    if (typeof item.document_id === "string" && typeof item.clause_id === "string") {
      const ref = item as unknown as ClauseRef;
      const key = `${ref.document_id}:${ref.clause_id}`;
      const clause = clauses[key];
      assert.ok(clause, key);
      if (ref.highlight) {
        const located = locateEvidence(clause.text, ref);
        assert.ok(located && !located.invalid, `${key}: ${ref.highlight}`);
      }
      count++;
    }
    Object.values(item).forEach(visit);
  }
  visit(result);
  assert.ok(count > 0);
});

test("compact source keeps the entire highlighted evidence even near the end", () => {
  const text = "Начало пункта. ".repeat(60) + "Полная доказательная цитата" + " Продолжение пункта.".repeat(30);
  const start = text.indexOf("Полная доказательная цитата");
  const evidence = { start, end: start + "Полная доказательная цитата".length };
  const range = clauseExcerptRange(text, evidence);
  assert.ok(range.start > 0 && range.end < text.length);
  assert.ok(range.start <= evidence.start && range.end >= evidence.end);
  assert.match(text.slice(range.start, range.end), /Полная доказательная цитата/);
  const longEvidence = { start: 10, end: 1200 };
  const longRange = clauseExcerptRange(text, longEvidence);
  assert.ok(longRange.start <= longEvidence.start && longRange.end >= longEvidence.end);
  assert.deepEqual(clauseExcerptRange("Краткий пункт", null), { start: 0, end: 13 });
});
