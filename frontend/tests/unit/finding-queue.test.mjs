import assert from "node:assert/strict";
import test from "node:test";
import { filterFindings, findingOwners, nextUnreviewedFinding, prioritizeFindings } from "../../src/features/results/model/finding-queue.ts";

function finding(id, overrides = {}) {
  return {
    id, title: id, change_type: "retained", issue_type: null,
    before_function_ids: [], after_function_ids: [], source_ids: [],
    explanation: "", recommendation: "", search: null,
    review: { status: "unreviewed", note: "" }, ...overrides,
  };
}

test("incomplete absence checks come first, rejected decisions remain visible at the end", () => {
  const findings = [
    finding("retained"),
    finding("conflict", { issue_type: "potential_conflict" }),
    finding("complete", { change_type: "potentially_missing", search: { complete: true, input_partial: false } }),
    finding("incomplete", { change_type: "potentially_missing", search: { complete: false } }),
    finding("rejected", { change_type: "potentially_missing", review: { status: "rejected" } }),
  ];
  assert.deepEqual(prioritizeFindings(findings).map((item) => item.id), ["incomplete", "complete", "conflict", "retained", "rejected"]);
  assert.equal(findings[0].id, "retained", "Sorting must not mutate query data");
});

test("the reassignment tile includes transfers, splits and merges without quiet changes", () => {
  const findings = ["transferred", "split", "merged", "retained", "new"].map((change_type) => finding(change_type, { change_type }));
  assert.deepEqual(filterFindings(findings, [], [], { change: "reassigned" }).map((item) => item.id), ["transferred", "split", "merged"]);
});

test("queue and table combine source search, owner, issue and saved review filters", () => {
  const functions = [{ id: "f1", actor_original: "Director", action: "Check", object: "Reports", scope: "Annual", owner_unit_ids: ["u1", "u2"] }];
  const sources = [{ id: "s1", clause_no: "5.6.3" }];
  const findings = [
    finding("match", { before_function_ids: ["f1"], source_ids: ["s1"], issue_type: "overlap", review: { status: "confirmed" } }),
    finding("unreviewed", { before_function_ids: ["f1"], source_ids: ["s1"], issue_type: "overlap" }),
  ];
  assert.deepEqual(filterFindings(findings, functions, sources, { query: " 5.6.3 ", unit: "u2", issue: "questions", review: "confirmed" }).map((item) => item.id), ["match"]);
  assert.equal(filterFindings(findings, functions, sources, { query: "annual" }).length, 2);
  assert.equal(filterFindings(findings, functions, sources, { unit: "unknown" }).length, 0);
});

test("many-to-many owners retain all distinct original names and unresolved actor text", () => {
  const functions = [
    { id: "f1", owner_unit_ids: ["u1", "u2"], actor_original: "Original actor" },
    { id: "f2", owner_unit_ids: ["u2"], actor_original: "Second actor" },
    { id: "f3", owner_unit_ids: [], actor_original: "Unresolved role" },
  ];
  const units = [{ id: "u1", name_original: "Аудит" }, { id: "u2", name_original: "Бақылау" }];
  assert.equal(findingOwners(["f1", "f2", "f3"], functions, units), "Аудит / Бақылау / Unresolved role");
});

test("after saving, navigation skips reviewed findings, wraps, and stops at an empty queue", () => {
  const items = [finding("first"), finding("saved"), finding("confirmed", { review: { status: "confirmed" } }), finding("last")];
  assert.equal(nextUnreviewedFinding(items, "saved"), "last");
  assert.equal(nextUnreviewedFinding(items, "last"), "first");
  assert.equal(nextUnreviewedFinding([finding("saved")], "saved"), undefined);
});
