import assert from "node:assert/strict";
import test from "node:test";
import { comparisonPair, diffWords, groupEvidence, locateEvidence } from "../../src/features/results/model/evidence.ts";

const quote = (side, overrides = {}) => ({
  source_id: `source-${side}`, document_id: `document-${side}`, filename: `${side}.docx`,
  side, clause_no: "5.1", original_text: "Duty", excerpt: "Duty", locator: {},
  evidence_role: side, start_offset: null, end_offset: null, ...overrides,
});
const finding = (overrides = {}) => ({
  before_function_ids: ["before"], after_function_ids: ["after"],
  change_type: "reworded", issue_type: null, ...overrides,
});

test("Python code point offsets convert astral Unicode to exact UTF-16 slices", () => {
  const text = "А😀 👨‍👩‍👧 міндет";
  const points = Array.from(text);
  const start = points.indexOf("м");
  const range = locateEvidence(text, { start_offset: start, end_offset: points.length, excerpt: "міндет" });
  assert.equal(text.slice(range.start, range.end), "міндет");
  assert.ok(range.start > start);
});

test("combining marks and original whitespace remain unchanged", () => {
  const text = "  e\u0301\r\n міндет  ";
  const excerpt = "e\u0301\r\n міндет";
  const range = locateEvidence(text, { start_offset: 2, end_offset: Array.from(text).length - 2, excerpt });
  assert.equal(text.slice(range.start, range.end), excerpt);
  assert.equal(text.slice(0, range.start) + excerpt + text.slice(range.end), text);
});

test("only explicit offsets select the intended repeated passage", () => {
  const text = "duty duty";
  assert.deepEqual(locateEvidence(text, { start_offset: 5, end_offset: 9, excerpt: "duty" }), { start: 5, end: 9 });
  assert.deepEqual(locateEvidence(text, { start_offset: null, end_offset: null, excerpt: "duty" }), { invalid: true });
});

test("whole-block citations without offsets do not invent highlights", () => {
  assert.equal(locateEvidence(" duty ", { start_offset: null, end_offset: null, excerpt: " duty " }), null);
});

test("invalid offsets or nonverbatim excerpt are rejected", () => {
  for (const [start, end, excerpt] of [[-1, 2, "Du"], [0, 8, "Duty"], [1, 1, ""], [0, null, "Duty"], [0.5, 2, "Du"], [0, 4, "duty"]]) {
    assert.deepEqual(locateEvidence("Duty", { start_offset: start, end_offset: end, excerpt }), { invalid: true });
  }
});

test("grouping preserves all direct evidence and separate supporting context", () => {
  const first = quote("after");
  const second = quote("after", { source_id: "second" });
  const context = quote("before", { evidence_role: "context" });
  const groups = groupEvidence([first, first, second, context]);
  assert.deepEqual(groups.after, [first, second]);
  assert.deepEqual(groups.before, []);
  assert.deepEqual(groups.context, [context]);
});

test("different cited ranges in the same source are retained", () => {
  const first = quote("after", { start_offset: 0, end_offset: 1, excerpt: "D" });
  const second = quote("after", { start_offset: 1, end_offset: 4, excerpt: "uty" });
  assert.equal(groupEvidence([first, second]).after.length, 2);
});

test("word comparison requires one saved function and quotation on each side", () => {
  const items = [quote("before"), quote("after")];
  assert.ok(comparisonPair(finding(), items));
  assert.equal(comparisonPair(finding({ after_function_ids: ["one", "two"] }), items), null);
  assert.equal(comparisonPair(finding({ change_type: "split" }), items), null);
  assert.equal(comparisonPair(finding({ issue_type: "overlap" }), items), null);
  assert.equal(comparisonPair(finding(), [...items, quote("after", { source_id: "second" })]), null);
  assert.equal(comparisonPair(finding(), [items[0], quote("after", { excerpt: "altered" })]), null);
});

test("two After risk sources are never silently treated as a before/after pair", () => {
  assert.equal(comparisonPair(finding({ before_function_ids: [], after_function_ids: ["a", "b"], issue_type: "potential_conflict" }),
    [quote("after"), quote("after", { source_id: "other" })]), null);
});

test("bounded word diff reconstructs both original strings exactly", () => {
  for (const [before, after] of [
    ["must audit\r\nrecords", "may audit\nrecords"],
    ["  русский\tмәтін 😀", " русский  text 😀"],
    ["", "inserted"], ["deleted", ""], ["same", "same"],
    ["<script>\n& text", "<script>\n& other text"],
  ]) {
    const parts = diffWords(before, after);
    assert.ok(parts);
    assert.equal(parts.filter((part) => part.kind !== "ins").map((part) => part.text).join(""), before);
    assert.equal(parts.filter((part) => part.kind !== "del").map((part) => part.text).join(""), after);
  }
});

test("word diff respects computation bounds without truncating originals", () => {
  assert.equal(diffWords("word ".repeat(301), "short"), null);
  assert.equal(diffWords("x".repeat(60_001), "short"), null);
  assert.deepEqual(diffWords("exact same", "exact same"), [{ kind: "same", text: "exact same" }]);
});
