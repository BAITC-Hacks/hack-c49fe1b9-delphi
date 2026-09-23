import type { Page } from "@playwright/test";
import type {
  AnalysisDetail,
  DocumentResponse,
  EvidenceResponse,
  FindingResponse,
  FunctionResponse,
  ReviewUpdated,
  RunDetail,
  SourceResponse,
  TranslationResponse,
  UpdateReview,
} from "../../src/shared/api/generated";

export const resultDataSource =
  "Synthetic API fixture; real frontend and authentication; no live AI";

const timestamp = "2026-09-23T08:00:00Z";
export const resultIds = {
  analysis: "10000000-0000-4000-8000-000000000001",
  run: "20000000-0000-4000-8000-000000000001",
  beforeDocument: "30000000-0000-4000-8000-000000000001",
  afterDocument: "30000000-0000-4000-8000-000000000002",
  beforeParent: "40000000-0000-4000-8000-000000000001",
  beforeSource: "40000000-0000-4000-8000-000000000002",
  afterSource: "40000000-0000-4000-8000-000000000003",
  beforeUnit: "50000000-0000-4000-8000-000000000001",
  afterUnit: "50000000-0000-4000-8000-000000000002",
  beforeFunction: "60000000-0000-4000-8000-000000000001",
  afterFunction: "60000000-0000-4000-8000-000000000002",
  transfer: "70000000-0000-4000-8000-000000000001",
  overlap: "70000000-0000-4000-8000-000000000002",
  missing: "70000000-0000-4000-8000-000000000003",
};

export const originalBeforeQuote =
  "1.1. Отдел аудита обязан проверять выполнение рекомендаций ежеквартально.";
export const originalAfterQuote =
  "2.1. Служба контроля обязана проверять выполнение рекомендаций ежеквартально.";
export const transferTitle = "Контроль рекомендаций передан Службе контроля";

function document(
  id: string,
  side: DocumentResponse["side"],
): DocumentResponse {
  return {
    id,
    analysis_id: resultIds.analysis,
    side,
    filename: `synthetic-${side}-regulation.md`,
    hash: side === "before" ? "a".repeat(64) : "b".repeat(64),
    revision_label:
      side === "before" ? "Synthetic revision 1" : "Synthetic revision 2",
    format: "md",
    detected_language: "ru",
    parse_status: "parsed",
    warnings: [],
    created_at: timestamp,
    block_count: side === "before" ? 2 : 1,
  };
}

export function createResultFixture(state: RunDetail["state"] = "completed") {
  const documents = [
    document(resultIds.beforeDocument, "before"),
    document(resultIds.afterDocument, "after"),
  ];
  const sources: SourceResponse[] = [
    {
      id: resultIds.beforeParent,
      document_id: resultIds.beforeDocument,
      clause_no: "1",
      parent_id: null,
      original_text: "1. Синтетическое положение. Функции Отдела аудита.",
      locator: { line: 1 },
    },
    {
      id: resultIds.beforeSource,
      document_id: resultIds.beforeDocument,
      clause_no: "1.1",
      parent_id: resultIds.beforeParent,
      original_text: originalBeforeQuote,
      locator: { line: 2 },
    },
    {
      id: resultIds.afterSource,
      document_id: resultIds.afterDocument,
      clause_no: "2.1",
      parent_id: null,
      original_text: originalAfterQuote,
      locator: { line: 1 },
    },
  ];
  const functions: FunctionResponse[] = [
    {
      id: resultIds.beforeFunction,
      run_id: resultIds.run,
      side: "before",
      owner_unit_ids: [resultIds.beforeUnit],
      actor_original: "Отдел аудита",
      action: "проверять",
      object: "выполнение рекомендаций",
      scope: "рекомендации по итогам аудита",
      condition: "ежеквартально",
      modality: "обязан",
      source_ids: [resultIds.beforeSource],
    },
    {
      id: resultIds.afterFunction,
      run_id: resultIds.run,
      side: "after",
      owner_unit_ids: [resultIds.afterUnit],
      actor_original: "Служба контроля",
      action: "проверять",
      object: "выполнение рекомендаций",
      scope: "рекомендации по итогам аудита",
      condition: "ежеквартально",
      modality: "обязана",
      source_ids: [resultIds.afterSource],
    },
  ];
  const transfer: FindingResponse = {
    id: resultIds.transfer,
    run_id: resultIds.run,
    title: transferTitle,
    change_type: "transferred",
    issue_type: null,
    before_function_ids: [resultIds.beforeFunction],
    after_function_ids: [resultIds.afterFunction],
    explanation:
      "В синтетическом примере изменён исполнитель; периодичность сохранена.",
    recommendation:
      "Подтвердить передачу ответственности по пунктам 1.1 и 2.1.",
    source_ids: [resultIds.beforeSource, resultIds.afterSource],
    search: null,
    review: {
      finding_id: resultIds.transfer,
      status: "unreviewed",
      note: "",
      updated_at: timestamp,
    },
  };
  const findings: FindingResponse[] = [
    transfer,
    {
      ...transfer,
      id: resultIds.overlap,
      title: "Возможное пересечение ответственности",
      change_type: "changed",
      issue_type: "overlap",
      explanation: "Синтетический вопрос для проверки фильтра пересечений.",
      review: { ...transfer.review, finding_id: resultIds.overlap },
    },
    {
      ...transfer,
      id: resultIds.missing,
      title: "Требуется уточнить полноту передачи функции",
      change_type: "potentially_missing",
      issue_type: "insufficient_evidence",
      after_function_ids: [],
      source_ids: [resultIds.beforeSource],
      explanation:
        "Синтетический пример неопределённости; потеря функции не утверждается.",
      search: {
        method: "semantic_all_after_batches",
        complete: false,
        reviewed_source_ids: [resultIds.afterSource],
        candidate_source_ids: [resultIds.afterSource],
        errors: ["Synthetic fixture: attachment was unavailable."],
        input_partial: true,
      },
      review: { ...transfer.review, finding_id: resultIds.missing },
    },
  ];
  const run: RunDetail = {
    id: resultIds.run,
    analysis_id: resultIds.analysis,
    state,
    stage: state === "running" ? "comparing" : state,
    output_language: "ru",
    model: "synthetic-browser-fixture",
    pipeline_version: "e2e-fixture-v1",
    review_revision: 0,
    coverage: {
      allow_partial: true,
      input_partial: false,
      input_warnings: {},
      total_documents: 2,
      total_sources: 3,
      processed_sources: 3,
      before_functions: 1,
      compared_before_functions: 1,
      after_functions: 1,
      reviewed_after_functions: 1,
      structure_units: 2,
      reviewed_structure_units: 2,
      unprocessed_source_ids: [],
      unreviewed_function_ids: [],
    },
    structure: [
      {
        id: "synthetic-structure-transfer",
        before_unit_ids: [resultIds.beforeUnit],
        after_unit_ids: [resultIds.afterUnit],
        status: "transformed",
        source_ids: [resultIds.beforeSource, resultIds.afterSource],
        explanation:
          "Синтетический пример: функция передана другому подразделению.",
      },
    ],
    errors:
      state === "failed"
        ? ["Synthetic fixture: provider unavailable; no result saved."]
        : [],
    created_at: timestamp,
    started_at: timestamp,
    finished_at: state === "running" || state === "queued" ? null : timestamp,
    units: [
      {
        id: resultIds.beforeUnit,
        side: "before",
        kind: "department",
        name_original: "Отдел аудита",
        parent_unit_id: null,
        source_ids: [resultIds.beforeSource],
      },
      {
        id: resultIds.afterUnit,
        side: "after",
        kind: "department",
        name_original: "Служба контроля",
        parent_unit_id: null,
        source_ids: [resultIds.afterSource],
      },
    ],
    finding_count: findings.length,
  };
  const analysis: AnalysisDetail = {
    id: resultIds.analysis,
    title: "SYNTHETIC · Audit responsibility transfer",
    created_at: timestamp,
    documents,
    run,
  };
  return { analysis, run, findings, functions, sources };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function installResultRoutes(
  page: Page,
  state: RunDetail["state"] = "completed",
) {
  const fixture = createResultFixture(state);
  const requests: { method: string; path: string; search: string }[] = [];
  const unhandled: string[] = [];
  const translations: TranslationResponse[] = [];

  await page.route("**/backend/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/backend/, "");
    const method = request.method();
    requests.push({ method, path, search: url.search });
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });

    if (method === "GET" && path === "/api/health")
      return json({ status: "ok", ai_configured: true });
    if (method === "GET" && path === `/api/analyses/${resultIds.analysis}`)
      return json(fixture.analysis);
    if (method === "GET" && path === `/api/runs/${resultIds.run}`)
      return json(fixture.run);
    if (method === "GET" && path === `/api/runs/${resultIds.run}/findings`)
      return json(fixture.findings);
    if (method === "GET" && path === `/api/runs/${resultIds.run}/functions`)
      return json(fixture.functions);
    const sourceMatch = path.match(/^\/api\/sources\/([^/]+)$/);
    if (method === "GET" && sourceMatch) {
      const source = fixture.sources.find((item) => item.id === sourceMatch[1]);
      return source
        ? json(source)
        : json(
            {
              code: "not_found",
              message: "Unknown synthetic source",
              details: [],
            },
            404,
          );
    }
    const documentMatch = path.match(
      /^\/api\/analyses\/([^/]+)\/documents\/([^/]+)\/sources$/,
    );
    if (method === "GET" && documentMatch?.[1] === resultIds.analysis)
      return json(
        fixture.sources.filter(
          (source) => source.document_id === documentMatch[2],
        ),
      );
    const evidenceMatch = path.match(/^\/api\/findings\/([^/]+)\/evidence$/);
    if (method === "GET" && evidenceMatch) {
      const finding = fixture.findings.find(
        (item) => item.id === evidenceMatch[1],
      );
      if (!finding)
        return json(
          {
            code: "not_found",
            message: "Unknown synthetic finding",
            details: [],
          },
          404,
        );
      const evidence: EvidenceResponse[] = fixture.sources
        .filter((source) => finding.source_ids.includes(source.id))
        .map((source) => {
          const doc = fixture.analysis.documents.find(
            (item) => item.id === source.document_id,
          )!;
          return {
            source_id: source.id,
            document_id: source.document_id,
            filename: doc.filename,
            side: doc.side,
            clause_no: source.clause_no,
            original_text: source.original_text,
            excerpt: source.original_text,
            locator: source.locator,
            evidence_role: doc.side,
            start_offset: 0,
            end_offset: source.original_text.length,
          };
        });
      return json(evidence);
    }
    const reviewMatch = path.match(/^\/api\/findings\/([^/]+)\/review$/);
    if (method === "PUT" && reviewMatch) {
      const finding = fixture.findings.find(
        (item) => item.id === reviewMatch[1],
      );
      if (!finding)
        return json(
          {
            code: "not_found",
            message: "Unknown synthetic finding",
            details: [],
          },
          404,
        );
      const body = request.postDataJSON() as UpdateReview;
      fixture.run.review_revision += 1;
      finding.review = {
        finding_id: finding.id,
        status: body.status,
        note: body.note,
        updated_at: `2026-09-23T08:00:${String(fixture.run.review_revision).padStart(2, "0")}Z`,
      };
      const updated: ReviewUpdated = {
        ...finding.review,
        review_revision: fixture.run.review_revision,
      };
      return json(updated);
    }
    if (
      method === "POST" &&
      path === `/api/runs/${resultIds.run}/translations`
    ) {
      const { locale } = request.postDataJSON() as {
        locale: TranslationResponse["locale"];
      };
      const translation: TranslationResponse = {
        run_id: resultIds.run,
        review_revision: fixture.run.review_revision,
        locale,
        cached: false,
        payload: {
          summary: "Synthetic saved-result translation.",
          findings: fixture.findings.map((finding) => ({
            id: finding.id,
            title:
              finding.id === resultIds.transfer
                ? "Recommendation monitoring transferred to Control Service"
                : `Translated: ${finding.title}`,
            explanation:
              "Synthetic translated explanation. Original source quotations remain unchanged.",
            recommendation:
              "Confirm the responsibility transfer using clauses 1.1 and 2.1.",
          })),
        },
      };
      translations.push(translation);
      return json(translation);
    }
    if (method === "GET" && path === `/api/runs/${resultIds.run}/report`) {
      const locale = url.searchParams.get("lang");
      if (
        locale !== fixture.run.output_language &&
        !translations.some(
          (item) =>
            item.locale === locale &&
            item.review_revision === fixture.run.review_revision,
        )
      )
        return json(
          {
            code: "translation_required",
            message: "Translate this review revision first.",
            details: [],
          },
          409,
        );
      const reviewed = fixture.findings[0].review;
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="${locale}"><head><title>Synthetic Delphi report</title><style>body{font:16px system-ui;padding:28px;color:#193047}h1{font-size:24px}blockquote{border-left:3px solid #2563eb;padding:14px;background:#f1f5f9}pre{white-space:pre-wrap}</style></head><body><h1>Synthetic Delphi report</h1><p>Browser fixture · no live AI analysis</p><p>Report language: ${locale?.toUpperCase()}</p><p>Review revision: ${fixture.run.review_revision}</p><h2>${escapeHtml(transferTitle)}</h2><p>Review status: ${reviewed.status}</p><pre>${escapeHtml(reviewed.note)}</pre><blockquote>${escapeHtml(originalBeforeQuote)}</blockquote><blockquote>${escapeHtml(originalAfterQuote)}</blockquote></body></html>`,
      });
    }
    if (method === "GET" && path === `/api/runs/${resultIds.run}/functions.csv`)
      return route.fulfill({
        contentType: "text/csv; charset=utf-8",
        body: `side,actor,source_id\nbefore,Отдел аудита,${resultIds.beforeSource}\nafter,Служба контроля,${resultIds.afterSource}\n`,
      });

    unhandled.push(`${method} ${path}`);
    return json(
      {
        code: "unexpected_fixture_request",
        message: `Unmocked fixture request: ${method} ${path}`,
        details: [],
      },
      501,
    );
  });
  return { ...fixture, requests, unhandled, translations };
}
