import { CompareView } from "@/components/compare-view";
import { SAMPLE_COMPARISON } from "@/lib/samples";

/**
 * 样例对比页（W11）—— 断网 / 无 API key 也能演示并列对比表。
 * 数据来自内置 lib/samples.ts，不经过模型。
 */
export default function SampleComparePage() {
  return <CompareView id="sample" initialData={SAMPLE_COMPARISON} />;
}
