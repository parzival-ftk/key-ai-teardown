import { REPORT_SECTIONS } from "@/lib/report/sections";

/**
 * 报告 → Markdown（Wave 5.5）—— 把 7 段式报告拼成可下载的 Markdown 文档。
 * 缺段的章节显式标注负责 Agent，不静默留空。
 */

export interface ReportMarkdownSection {
  agentId: string;
  name?: string;
  output: string;
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
    lines.push(
      output ? output : `（待补充 —— 由「${spec.owner}」负责）`,
    );
    lines.push("");
  });

  return lines.join("\n");
}
