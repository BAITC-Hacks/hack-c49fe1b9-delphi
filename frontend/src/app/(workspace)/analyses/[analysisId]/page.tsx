import { ResultsWorkspace } from "@/features/results/client";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  return <ResultsWorkspace analysisId={analysisId} />;
}
