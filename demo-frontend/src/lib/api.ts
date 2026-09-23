import type {
  AnalysisResult,
  ApiAnalysis,
  ApiAnalysisDetail,
  ApiAnalysisListItem,
  ApiDocument,
  ApiEvidence,
  ApiFinding,
  ApiFunction,
  ApiHealth,
  ApiReviewUpdated,
  ApiRunAccepted,
  ApiRunDetail,
  ApiSide,
  ApiSource,
  Clause,
  JobStatus,
  LiveBundle,
  ReviewStatus,
} from "@/types";
import { editionLabels, toAnalysisResult, toClause, toJobStatus } from "@/lib/adapter";

/**
 * Backend API (backend/openapi.json, granular): analyses → documents → runs → findings/functions →
 * evidence/sources. Screens keep using the UI contract from types.ts; lib/adapter.ts does the mapping.
 * `DEMO_ID` never reaches the backend: the offline example is read from public/demo/*.json.
 */

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export const DEMO_ID = "demo";

/** Server limits from backend/.env.example (MAX_UPLOAD_BYTES, MAX_DOCUMENTS_PER_ANALYSIS). */
export const LIMITS = { fileBytes: 10 * 1024 * 1024, documents: 10, formats: [".docx", ".pdf", ".xlsx", ".md"] };

export interface AnalysisSummary {
  id: string;
  title?: string;
  created_at?: string;
  /** draft | running | done | partial | error | interrupted */
  state: string;
  /** History links to the progress screen while running and after a failure. */
  run_id?: string;
  documents_before?: number;
  documents_after?: number;
  open_questions?: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Russian texts for the backend's error codes; unknown codes fall back to the server message. */
const ERROR_RU: Record<string, string> = {
  ai_not_configured: "ИИ не настроен на сервере (нет ключа модели). Документы загружены, запуск анализа недоступен.",
  partial_input: "Часть текста прочитана не полностью. Отметьте «Запустить ограниченный анализ», чтобы продолжить.",
  unsupported_format: "Формат не поддерживается: нужны DOCX, PDF с текстовым слоем, XLSX или Markdown.",
  empty_file: "Файл пустой.",
  corrupt_document: "Файл повреждён или не читается.",
  encrypted_document: "Файл защищён паролем — загрузите версию без защиты.",
  invalid_format: "Содержимое файла не соответствует расширению.",
  invalid_encoding: "Не удалось прочитать кодировку текста.",
  no_text: "В документе не найден текст. Сканированные PDF без текстового слоя не обрабатываются.",
  expanded_size_limit: "Документ слишком большой после распаковки.",
  upload_size_limit: "Файл больше допустимого размера (10 МБ).",
  document_limit: "Не больше 10 документов на одно сравнение.",
  duplicate_document: "Этот файл уже загружен на эту сторону.",
  invalid_filename: "Некорректное имя файла.",
  missing_side: "Нужен хотя бы один документ «До» и один «После».",
  unreadable_document: "В каждом документе должен быть читаемый текст.",
  immutable_analysis: "Документы запущенного сравнения менять нельзя — создайте новое сравнение.",
  run_exists: "Анализ уже запущен с другими параметрами. Повторите сравнение.",
  run_not_finished: "Отчёт доступен после завершения анализа.",
  run_not_found: "Запуск анализа не найден.",
  document_not_found: "Документ не найден.",
  not_found: "Не найдено на сервере.",
  incomplete_saved_result: "Сохранённый результат неполон.",
  internal_error: "Внутренняя ошибка сервера анализа.",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "Нет соединения с сервером анализа");
  }
  if (!res.ok) {
    let message = `Ошибка сервера (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { code?: string; message?: string; detail?: unknown };
      code = body.code;
      message =
        (code && ERROR_RU[code]) ?? body.message ?? (typeof body.detail === "string" ? body.detail : message);
    } catch {
      if (res.status === 502 || res.status === 504) message = "Сервер анализа недоступен";
    }
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const id = encodeURIComponent;

// ---- Health and history --------------------------------------------------------------------------

export function getHealth() {
  return request<ApiHealth>("/api/health");
}

const HISTORY_STATE: Record<ApiAnalysisListItem["state"], string> = {
  draft: "draft",
  queued: "running",
  running: "running",
  completed: "done",
  partial: "partial",
  failed: "error",
  interrupted: "interrupted",
};

export async function listAnalyses(): Promise<AnalysisSummary[]> {
  const items = await request<ApiAnalysisListItem[]>("/api/analyses");
  return items.map((a) => ({
    id: a.id,
    title: a.title,
    created_at: a.created_at,
    state: HISTORY_STATE[a.state] ?? a.state,
    run_id: a.run_id ?? undefined,
  }));
}

// ---- New comparison: create → upload each file → start ----------------------------------------------

export function createAnalysis(title: string) {
  return request<ApiAnalysis>("/api/analyses", json("POST", { title }));
}

export function uploadDocument(analysisId: string, side: ApiSide, file: File) {
  const fd = new FormData();
  fd.append("side", side);
  fd.append("file", file);
  return request<ApiDocument>(`/api/analyses/${id(analysisId)}/documents`, { method: "POST", body: fd });
}

export async function deleteDocument(analysisId: string, documentId: string) {
  try {
    await request<void>(`/api/analyses/${id(analysisId)}/documents/${id(documentId)}`, { method: "DELETE" });
  } catch (error) {
    // A previous request may have committed before its response was lost.
    if (error instanceof ApiError && error.code === "document_not_found") return;
    throw error;
  }
}

export function startRun(analysisId: string, allowPartial: boolean) {
  return request<ApiRunAccepted>(
    `/api/analyses/${id(analysisId)}/runs`,
    json("POST", { output_language: "ru", allow_partial: allowPartial }),
  );
}

// ---- Progress --------------------------------------------------------------------------------------

export async function getRun(runId: string): Promise<JobStatus> {
  return toJobStatus(await request<ApiRunDetail>(`/api/runs/${id(runId)}`));
}

/** A failed or interrupted run cannot be resumed: repeat the analysis (same documents) and start again. */
export async function repeatRun(analysisId: string, allowPartial: boolean): Promise<string> {
  const copy = await request<ApiAnalysis>(`/api/analyses/${id(analysisId)}/repeat`, { method: "POST" });
  return (await startRun(copy.id, allowPartial)).run_id;
}

// ---- Result ----------------------------------------------------------------------------------------

/** Verbatim blocks of the live result, filled by getAnalysis; the evidence drawer reads from here first. */
const liveClauses = new Map<string, Clause>();
/** Last loaded bundle per analysis: a saved review re-derives the result without refetching. */
const liveBundles = new Map<string, LiveBundle>();

/** Runs `fn` over `items` with at most `limit` requests in flight. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function loadLiveBundle(analysisId: string): Promise<LiveBundle> {
  const analysis = await request<ApiAnalysisDetail>(`/api/analyses/${id(analysisId)}`);
  if (!analysis.run) throw new ApiError(409, "Анализ ещё не запускался: документы загружены, но сравнение не начато.");
  const runId = analysis.run.id;
  const [run, findings, functions, sourceLists] = await Promise.all([
    request<ApiRunDetail>(`/api/runs/${id(runId)}`),
    request<ApiFinding[]>(`/api/runs/${id(runId)}/findings`),
    request<ApiFunction[]>(`/api/runs/${id(runId)}/functions`),
    Promise.all(
      analysis.documents.map((d) =>
        request<ApiSource[]>(`/api/analyses/${id(analysisId)}/documents/${id(d.id)}/sources`),
      ),
    ),
  ]);
  if (run.state === "queued" || run.state === "running") {
    throw new ApiError(409, "Анализ ещё выполняется. Откройте экран прогресса.", "run_in_progress");
  }
  const evidenceErrors: Record<string, string> = {};
  const evidenceLists = await mapLimited(findings, 6, async (f) => {
    try { return await request<ApiEvidence[]>(`/api/findings/${id(f.id)}/evidence`); }
    catch (e) {
      evidenceErrors[f.id] = e instanceof Error ? e.message : "Не удалось загрузить доказательства";
      return [];
    }
  });
  const sources: Record<string, ApiSource> = {};
  sourceLists.flat().forEach((s) => (sources[s.id] = s));
  const evidence: Record<string, ApiEvidence[]> = {};
  findings.forEach((f, i) => (evidence[f.id] = evidenceLists[i]));

  const labels = editionLabels(analysis.documents);
  Object.values(sources).forEach((s) =>
    liveClauses.set(s.id, toClause(s, labels[s.document_id] ?? "", s.parent_id ? sources[s.parent_id] : undefined)),
  );
  return { analysis, run, findings, functions, sources, evidence, evidenceErrors };
}

export async function getAnalysis(analysisId: string): Promise<AnalysisResult> {
  if (analysisId === DEMO_ID) {
    const res = await fetch("/demo/result.json");
    if (!res.ok) throw new ApiError(res.status, "Не удалось загрузить пример");
    return (await res.json()) as AnalysisResult;
  }
  const bundle = await loadLiveBundle(analysisId);
  liveBundles.set(analysisId, bundle);
  return toAnalysisResult(bundle);
}

let demoClauses: Promise<Record<string, Clause>> | null = null;

export async function getClause(analysisId: string, documentId: string, clauseId: string): Promise<Clause> {
  if (analysisId === DEMO_ID) {
    demoClauses ??= fetch("/demo/clauses.json").then((r) => {
      if (!r.ok) throw new ApiError(r.status, "Не удалось загрузить фрагменты примера");
      return r.json() as Promise<Record<string, Clause>>;
    });
    const map = await demoClauses;
    const clause = map[`${documentId}:${clauseId}`];
    if (!clause) throw new ApiError(404, "Пункт не найден в примере");
    return clause;
  }
  // Live: clause_id is the backend source_id.
  const cached = liveClauses.get(clauseId);
  if (cached) return cached;
  const source = await request<ApiSource>(`/api/sources/${id(clauseId)}`);
  const parent = source.parent_id
    ? await request<ApiSource>(`/api/sources/${id(source.parent_id)}`).catch(() => undefined)
    : undefined;
  const clause = toClause(source, "", parent);
  liveClauses.set(clauseId, clause);
  return clause;
}

// ---- Review and server exports ---------------------------------------------------------------------

export function updateReview(findingId: string, status: ReviewStatus, note: string) {
  return request<ApiReviewUpdated>(`/api/findings/${id(findingId)}/review`, json("PUT", { status, note }));
}

/** Saves a review and returns the result rebuilt from the same bundle (conclusion and export follow it). */
export async function saveReview(analysisId: string, findingId: string, status: ReviewStatus, note: string) {
  const saved = await updateReview(findingId, status, note);
  const bundle = liveBundles.get(analysisId);
  if (!bundle) return getAnalysis(analysisId);
  const findings = bundle.findings.map((f) =>
    f.id === findingId ? { ...f, review: { finding_id: f.id, status: saved.status, note: saved.note, updated_at: saved.updated_at } } : f,
  );
  const next: LiveBundle = { ...bundle, findings, run: { ...bundle.run, review_revision: saved.review_revision } };
  liveBundles.set(analysisId, next);
  return toAnalysisResult(next);
}

export function reportUrl(runId: string, lang: "ru" | "kk" | "en" = "ru") {
  return `${BASE}/api/runs/${id(runId)}/report?lang=${lang}&format=html`;
}

export function functionsCsvUrl(runId: string, lang: "ru" | "kk" | "en" = "ru") {
  return `${BASE}/api/runs/${id(runId)}/functions.csv?lang=${lang}`;
}
