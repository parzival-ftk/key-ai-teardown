import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QualityBoard } from "./QualityBoard";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import { EVAL_DIMENSIONS } from "@/lib/eval/dimensions";
import type { EvaluableSection } from "@/lib/eval/judgeAgent";
import type { Evidence } from "@/lib/types/evidence";

function report(overrides: Record<string, string> = {}, evidence?: Evidence[]) {
  const sections: EvaluableSection[] = REPORT_SECTIONS.map((spec) => ({
    agentId: spec.agentId,
    output: overrides[spec.agentId] ?? "（分析正文）",
  }));
  if (evidence) sections[0].evidence = evidence;
  return { name: "Notion", sections };
}

const GOOD = report(
  {
    "user-research": "画像 persona；JTBD functional / emotional / social",
    interviewer: "摩擦点：模板太多",
    synthesis: "分歧裁决：采纳质疑",
    prd: "用户故事 As a… 验收标准 Given When Then 成功指标 北极星 功能范围 MVP 发布就绪清单 风险与依赖",
  },
  [
    { claim: "A", label: "verified", source: "notion.so" },
    { claim: "B", label: "verified", source: "notion.so 设计说明" },
  ],
);

describe("QualityBoard（服务端静态渲染）", () => {
  it("默认收起：只露标题与综合分徽章，不渲染维度行", () => {
    const html = renderToStaticMarkup(<QualityBoard report={GOOD} />);
    expect(html).toContain("质量与可信度评估");
    expect(html).toContain("data-quality-badge");
    expect(html).toContain('data-quality-open="false"');
    expect(html).toContain("/100");
    expect(html).not.toContain("data-quality-dimension=");
  });

  it("展开后渲染四个维度、进度条与显式提示点", () => {
    const html = renderToStaticMarkup(
      <QualityBoard report={GOOD} defaultOpen />,
    );
    expect(html).toContain('data-quality-open="true"');
    for (const dim of EVAL_DIMENSIONS) {
      expect(html, `缺维度 ${dim.id}`).toContain(
        `data-quality-dimension="${dim.id}"`,
      );
      expect(html).toContain(dim.name);
      expect(html).toContain(dim.nameEn);
    }
    // 显式提示点：例如「证据追溯度 100 分：100% 结论已核实（2/2 条）」
    expect(html).toContain("证据追溯度");
    expect(html).toContain("% 结论已核实");
    expect(html).toContain("width:100%");
  });

  it("门禁状态与综合分写入数据属性（便于断言与验收）", () => {
    const html = renderToStaticMarkup(
      <QualityBoard report={GOOD} defaultOpen threshold={80} />,
    );
    expect(html).toMatch(/data-quality-composite="(8[0-9]|9[0-9]|100)"/);
    expect(html).toContain("门禁阈值 80 分");
    expect(html).toContain("已达标");
  });

  it("空报告：综合分 0、给出 critical 降级建议、不崩", () => {
    const html = renderToStaticMarkup(
      <QualityBoard report={{ sections: [] }} defaultOpen />,
    );
    expect(html).toContain('data-quality-composite="0"');
    expect(html).toContain('data-quality-suggestion="critical"');
    expect(html).toContain("报告为空");
    expect(html).toContain("未达标");
  });

  it("伪造引用：追溯度标记「已降级」并给 critical 建议", () => {
    const html = renderToStaticMarkup(
      <QualityBoard
        report={report({}, [{ claim: "A", label: "verified" }])}
        defaultOpen
      />,
    );
    expect(html).toContain("已降级");
    expect(html).toContain("伪造引用");
  });
});
