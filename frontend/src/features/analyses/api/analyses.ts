import {
  createAnalysis,
  deleteDocument,
  getAnalysis,
  listAnalyses,
  listDocumentSources,
  repeatAnalysis,
  startRun,
  updateDocument,
  uploadDocument,
  type PatchDocument,
  type StartRun,
} from "@/shared/api/generated";
import { unwrap } from "@/shared/api/errors";

export async function loadAnalyses() {
  return unwrap(await listAnalyses());
}

export async function loadAnalysis(analysisId: string) {
  return unwrap(await getAnalysis({ path: { analysis_id: analysisId } }));
}

export async function saveAnalysis(title: string) {
  return unwrap(await createAnalysis({ body: { title } }));
}

export async function copyAnalysis(analysisId: string) {
  return unwrap(await repeatAnalysis({ path: { analysis_id: analysisId } }));
}

export async function addDocument(analysisId: string, side: "before" | "after", file: File) {
  return unwrap(await uploadDocument({ path: { analysis_id: analysisId }, body: { side, file } }));
}

export async function editDocument(analysisId: string, documentId: string, body: PatchDocument) {
  return unwrap(await updateDocument({ path: { analysis_id: analysisId, document_id: documentId }, body }));
}

export async function removeDocument(analysisId: string, documentId: string) {
  const result = await deleteDocument({ path: { analysis_id: analysisId, document_id: documentId } });
  if (result.error) unwrap(result);
}

export async function loadDocumentSources(analysisId: string, documentId: string) {
  return unwrap(await listDocumentSources({ path: { analysis_id: analysisId, document_id: documentId } }));
}

export async function beginRun(analysisId: string, body: StartRun) {
  return unwrap(await startRun({ path: { analysis_id: analysisId }, body }));
}
