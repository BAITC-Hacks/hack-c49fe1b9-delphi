import {
  createTranslation,
  exportFunctions,
  getAnalysis,
  getFindingEvidence,
  getReport,
  getRun,
  getSource,
  listDocumentSources,
  listFindings,
  listFunctions,
  repeatAnalysis,
  updateFindingReview,
} from "@/shared/api/generated";
import type { RunDetail, UpdateReview } from "@/shared/api/generated";
import { unwrap } from "@/shared/api/errors";

type Locale = RunDetail["output_language"];

export const resultsApi = {
  analysis: async (id: string) =>
    unwrap(await getAnalysis({ path: { analysis_id: id } })),
  run: async (id: string) => unwrap(await getRun({ path: { run_id: id } })),
  findings: async (id: string) =>
    unwrap(await listFindings({ path: { run_id: id } })),
  functions: async (id: string) =>
    unwrap(await listFunctions({ path: { run_id: id } })),
  evidence: async (id: string) =>
    unwrap(await getFindingEvidence({ path: { finding_id: id } })),
  source: async (id: string) =>
    unwrap(await getSource({ path: { source_id: id } })),
  documentSources: async (analysisId: string, documentId: string) =>
    unwrap(
      await listDocumentSources({
        path: { analysis_id: analysisId, document_id: documentId },
      }),
    ),
  review: async (id: string, body: UpdateReview) =>
    unwrap(
      await updateFindingReview({
        path: { finding_id: id },
        body,
      }),
    ),
  repeat: async (id: string) =>
    unwrap(await repeatAnalysis({ path: { analysis_id: id } })),
  report: async (id: string, locale: Locale) =>
    unwrap(
      await getReport({
        path: { run_id: id },
        query: { lang: locale, format: "html" },
        parseAs: "text",
      }),
    ),
  csv: async (id: string, locale: Locale) =>
    unwrap(
      await exportFunctions({
        path: { run_id: id },
        query: { lang: locale },
        parseAs: "text",
      }),
    ),
  translate: async (id: string, locale: Locale) =>
    unwrap(
      await createTranslation({
        path: { run_id: id },
        body: { locale },
      }),
    ),
};

export function saveFile(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
