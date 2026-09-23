import { ComparisonEditor } from "@/features/analyses/client";

export default async function NewComparisonPage({ searchParams }: { searchParams: Promise<{ analysis?: string }> }) {
  const { analysis } = await searchParams;
  return <ComparisonEditor analysisId={analysis} />;
}
