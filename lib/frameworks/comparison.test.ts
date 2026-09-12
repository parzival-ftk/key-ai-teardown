import { describe, it, expect } from "vitest";
import { buildComparisonUserPrompt, comparisonSystemPrompt } from "./comparison";

describe("对比官提示词（W11）", () => {
  it("系统提示要求并列对比表与关键对比维度，且声明推测纪律", () => {
    for (const kw of [
      "并列对比表",
      "目标用户",
      "商业模式",
      "风险",
      "选择建议",
    ]) {
      expect(comparisonSystemPrompt).toContain(kw);
    }
    expect(comparisonSystemPrompt).toContain("（推测）");
  });

  it("用户消息铺开各产品报告并要求产出对比矩阵", () => {
    const msg = buildComparisonUserPrompt([
      { name: "Notion", reportText: "报告A" },
      { name: "Figma", reportText: "报告B" },
    ]);
    expect(msg).toContain("产品 1：Notion");
    expect(msg).toContain("产品 2：Figma");
    expect(msg).toContain("报告A");
    expect(msg).toContain("报告B");
    expect(msg).toContain("对比矩阵");
  });

  it("空报告用占位而非空白", () => {
    expect(
      buildComparisonUserPrompt([{ name: "X", reportText: "" }]),
    ).toContain("（无内容）");
  });
});
