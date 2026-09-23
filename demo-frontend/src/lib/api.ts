import type { AnalysisResult, Clause, JobStatus } from "@/types";

/**
 * UI contract (composite, see frontend/README.md). Backend may implement the granular API from
 * docs/architecture.md underneath; the UI only needs these aggregate endpoints:
 *   POST /api/analyses                 multipart before[] / after[]  → { analysis_id, run_id }
 *   GET  /api/analyses                 → AnalysisSummary[]
 *   GET  /api/runs/:run_id             → JobStatus (stage 1–5, stage_state, counters, analysis_id)
 *   POST /api/runs/:run_id/retry       → JobStatus
 *   POST /api/runs/:run_id/cancel      → 204
 *   GET  /api/analyses/:id             → AnalysisResult (units, functions, risks, conclusion, trace)
 *   GET  /api/analyses/:id/sources/:document_id/:clause_id → Clause (verbatim text)
 */

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export const DEMO_ID = "demo";

export interface AnalysisSummary {
  id: string;
  title?: string;
  created_at?: string;
  /** draft | running | done | partial | error | interrupted */
  state: string;
  /** Present while running: history links to the progress screen instead of an empty result. */
  run_id?: string;
  documents_before?: number;
  documents_after?: number;
  open_questions?: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "Нет соединения с сервером анализа");
  }
  if (!res.ok) {
    let message = `Ошибка сервера (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message_ru?: string }; detail?: string };
      message = body?.error?.message_ru ?? body?.detail ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listAnalyses() {
  return request<AnalysisSummary[]>("/api/analyses");
}

export function createAnalysis(before: File[], after: File[], title?: string) {
  const fd = new FormData();
  if (title) fd.append("title", title);
  before.forEach((f) => fd.append("before", f));
  after.forEach((f) => fd.append("after", f));
  return request<{ analysis_id: string; run_id: string }>("/api/analyses", { method: "POST", body: fd });
}

export function getRun(runId: string) {
  return request<JobStatus>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function retryStage(runId: string) {
  return request<JobStatus>(`/api/runs/${encodeURIComponent(runId)}/retry`, { method: "POST" });
}

export function cancelRun(runId: string) {
  return request<void>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }).catch(
    () => undefined,
  );
}

export async function getAnalysis(id: string): Promise<AnalysisResult> {
  if (id === DEMO_ID) {
    const res = await fetch("/demo/result.json");
    if (!res.ok) throw new ApiError(res.status, "Не удалось загрузить пример");
    return (await res.json()) as AnalysisResult;
  }
  return request<AnalysisResult>(`/api/analyses/${encodeURIComponent(id)}`);
}

let demoClauses: Promise<Record<string, Clause>> | null = null;

export async function getClause(
  analysisId: string,
  documentId: string,
  clauseId: string,
): Promise<Clause> {
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
  return request<Clause>(
    `/api/analyses/${encodeURIComponent(analysisId)}/sources/${encodeURIComponent(documentId)}/${encodeURIComponent(clauseId)}`,
  );
}
