import { REPORT_SECTIONS } from "@/lib/report/sections";
import { EVIDENCE_LABEL } from "@/lib/report/evidence-labels";
import type { Evidence } from "@/lib/types/evidence";

/**
 * 报告 → Markdown（Wave 5.5；W2 补证据标签）—— 把 7 段式报告拼成可下载的文档。
 * 缺段的章节显式标注负责 Agent，不静默留空；
 * 带证据的章节在正文后附「证据标签」列表（[已核实]/[推测]/[缺失]）。
 */

export interface ReportMarkdownSection {
  agentId: string;
  name?: string;
  output: string;
  /** 证据标签（W2）—— 导出时附在段落末尾 */
  evidence?: Evidence[];
}

export interface ReportMarkdownInput {
  name?: string;
  sections: ReportMarkdownSection[];
}

export function reportToMarkdown(report: ReportMarkdownInput): string {
  const byAgent = new Map(report.sections.map((s) => [s.agentId, s]));
  const lines: string[] = [
    `# ${report.name?.trim() || "产品"} · 拆解报告`,
    "",
    "> 由 Key · AI 产品拆解助手生成",
    "",
  ];

  REPORT_SECTIONS.forEach((spec, i) => {
    const section = byAgent.get(spec.agentId);
    lines.push(`## ${i + 1}. ${spec.title}`);
    lines.push("");
    const output = section?.output?.trim();
    lines.push(output ? output : `（待补充 —— 由「${spec.owner}」负责）`);
    lines.push("");

    // W2：把该段的证据标签附在正文之后（无证据则不产生空块）
    const evidence = section?.evidence ?? [];
    if (evidence.length > 0) {
      lines.push("**证据标签**");
      lines.push("");
      for (const e of evidence) {
        const source = e.source ? `（${e.source}）` : "";
        lines.push(`- [${EVIDENCE_LABEL[e.label]}] ${e.claim}${source}`);
      }
      lines.push("");
    }
  });

  return lines.join("\n");
}
