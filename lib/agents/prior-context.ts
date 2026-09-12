import type { AgentResult } from "@/lib/types/agent";

/** Agent id → 展示名（供下游 Agent 的上下文文本使用） */
const AGENT_LABELS: Record<string, string> = {
  market: "竞品分析师",
  "user-research": "用户研究员",
  business: "商业模式分析师",
  interviewer: "用户访谈官",
  "devils-advocate": "反方质疑官",
  synthesis: "PM 综合官",
};

/**
 * 把前序 Agent 结果汇总成给下游 Agent（辩论 / 综合 / PRD）的上下文文本。
 * 失败的 Agent 会被显式标注，但不会中断汇总。
 */
export function formatPriorResults(results: AgentResult[]): string {
  if (results.length === 0) return "（无前序分析可用）";

  return results
    .map((r) => {
      const label = AGENT_LABELS[r.agentId] ?? r.agentId;
      if (r.failed || !r.output) {
        return `### ${label}\n（该分析失败：${r.error ?? "未知原因"}）`;
      }
      return `### ${label}\n${r.output}`;
    })
    .join("\n\n");
}
