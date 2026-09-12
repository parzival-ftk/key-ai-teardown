import { describe, it, expect } from "vitest";
import { formatPriorResults } from "./prior-context";
import type { AgentResult } from "@/lib/types/agent";

function result(agentId: string, output: string): AgentResult {
  return { agentId, output, evidence: [], failed: false };
}

describe("前序结果格式化（W5 审查修复）", () => {
  it("视觉设计分析师有中文展示名，不回落成英文 id", () => {
    const text = formatPriorResults([result("visual-design", "色板：中性色")]);
    expect(text).toContain("视觉设计分析师");
    expect(text).not.toContain("### visual-design");
  });

  it("未知 agent id 回落为原 id（安全降级，不抛错）", () => {
    expect(formatPriorResults([result("mystery", "x")])).toContain(
      "### mystery",
    );
  });

  it("空结果给出显式提示", () => {
    expect(formatPriorResults([])).toContain("无前序分析");
  });

  it("失败的 Agent 被显式标注，不中断汇总", () => {
    const text = formatPriorResults([
      { agentId: "market", output: "", evidence: [], failed: true, error: "超时" },
      result("business", "商业模式正文"),
    ]);
    expect(text).toContain("该分析失败");
    expect(text).toContain("超时");
    expect(text).toContain("商业模式正文");
  });
});
