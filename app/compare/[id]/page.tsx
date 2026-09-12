import { CompareView } from "@/components/compare-view";

export default async function CompareResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CompareView id={id} />;
}
