import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildQueue } from "@/hooks/useReviewQueue";
import { FindingDetail } from "@/components/review/FindingDetail";
import type { AnalysisResult, FunctionMapping } from "@/types";

function result(functions: FunctionMapping[]): AnalysisResult {
  return {
    id: "test", mode: "synthetic", editions: { before: { label: "До" }, after: { label: "После" } },
    units: [], functions, risks: [], conclusion: { sections: [], limitations: [] }, trace: [],
    // Overall processing coverage cannot substitute for search coverage of a finding.
    coverage: { complete: true, processed: 10, total: 10 },
  };
}

const missing: FunctionMapping = { id: "missing", title: "Соответствие не найдено", status: "missing", before: [], after: [] };

test("queue warns about absent missing-search coverage even when overall processing is complete", () => {
  const items = buildQueue(result([
    { ...missing, id: "searched", search: { complete: true, reviewed: 5, candidates: 0, errors: [], text: "Поиск по 5 пунктам, полный: да." } },
    missing,
  ]));
  assert.equal(items[0].id, "missing");
  assert.equal(items[0].searchIncomplete, true);
  assert.equal(items[0].searchUnknown, true);
  assert.equal(items[0].search, undefined);
  const html = renderToStaticMarkup(createElement(FindingDetail, { item: items[0], analysisId: "test" }));
  assert.match(html, /Полнота поиска не подтверждена/);
  assert.doesNotMatch(html, /полный: да/);
  assert.equal(items[1].searchIncomplete, false);
  assert.equal(items[1].searchUnknown, false);
});

test("known incomplete search retains coverage explanation without being described as absent", () => {
  const [item] = buildQueue(result([{ ...missing, search: {
    complete: false, reviewed: 3, candidates: 0, errors: ["Недоступен документ"], text: "Проверено 3 пункта. Недоступен документ.",
  } }]));
  assert.equal(item.searchIncomplete, true);
  assert.equal(item.searchUnknown, false);
  const html = renderToStaticMarkup(createElement(FindingDetail, { item, analysisId: "test" }));
  assert.match(html, /Проверено 3 пункта\. Недоступен документ\./);
  assert.doesNotMatch(html, /данные о покрытии поиска.*отсутствуют/);
});
