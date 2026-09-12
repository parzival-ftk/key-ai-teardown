import { AnalyzeView } from "@/components/analyze-view";

export default async function AnalyzePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AnalyzeView id={id} />;
}
