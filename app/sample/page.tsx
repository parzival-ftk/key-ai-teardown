import { ReportView } from "@/components/report-view";
import { SAMPLE_REPORT } from "@/lib/samples";

/**
 * 样例报告页（Wave 6.3）—— 断网 / 无 API key 也能完整演示。
 * 数据来自内置 lib/samples.ts，不经过模型。
 */
export default function SampleReportPage() {
  return <ReportView id="sample" initialData={SAMPLE_REPORT} />;
}
