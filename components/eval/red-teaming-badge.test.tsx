import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QualityBoard } from "./QualityBoard";
import { RedTeamingBadge } from "./RedTeamingBadge";
import { runRedTeam } from "@/lib/eval/redTeaming";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import type { EvaluableSection } from "@/lib/eval/judgeAgent";
import type { Evidence } from "@/lib/types/evidence";

function report(overrides: Record<string, string> = {}, evidence?: Evidence[]) {
  const sections: EvaluableSection[] = REPORT_SECTIONS.map((spec) => ({
    agentId: spec.agentId,
    output: overrides[spec.agentId] ?? "（分析正文）",
    ...(evidence && spec.agentId === "market" ? { evidence } : {}),
  }));
  return { name: "Notion", sections };
}

const FABRICATED = report({}, [
  { claim: "壁垒极高", label: "verified" },
  { claim: "有来源的结论", label: "verified", source: "notion.so" },
]);

const CLEAN = report(
  {
    "user-research": "画像 persona；JTBD functional / emotional / social",
    interviewer: "摩擦点：模板太多",
    synthesis: "分歧裁决：采纳质疑",
    prd: "用户故事 As a… 验收标准 Given When Then 成功指标 北极星 功能范围 MVP 发布就绪清单 风险与依赖",
  },
  [{ claim: "官方页面可用", label: "verified", source: "notion.so" }],
);

describe("RedTeamingBadge（独立渲染）", () => {
  it("无异常时显示绿色「未发现异常」", () => {
    const html = renderToStaticMarkup(
      <RedTeamingBadge report={runRedTeam(CLEAN)} />,
    );
    expect(html).toContain('data-red-team-blocked="0"');
    expect(html).toContain("未发现异常");
    expect(html).not.toContain("data-red-team-downgrade=");
  });

  it("有拦截时显示条数、矛盾点与降级日志", () => {
    const redTeam = runRedTeam(FABRICATED);
    const html = renderToStaticMarkup(
      <RedTeamingBadge report={redTeam} defaultOpen />,
    );
    expect(html).toContain('data-red-team-blocked="1"');
    expect(html).toContain("拦截 1 条");
    expect(html).toContain('data-red-team-finding="fabricated_citation"');
    expect(html).toContain("虚构引用");
    expect(html).toContain('data-red-team-downgrade="market#0"');
    expect(html).toContain("verified → inferred");
    expect(html).toContain("壁垒极高");
  });

  it("矛盾事实会被标注出来", () => {
    const redTeam = runRedTeam(
      report({
        market: "市场规模约 40 亿美元。",
        business: "市场规模约 80 亿美元。",
      }),
    );
    const html = renderToStaticMarkup(
      <RedTeamingBadge report={redTeam} defaultOpen />,
    );
    expect(html).toContain('data-red-team-finding="contradiction"');
    expect(html).toContain("矛盾事实");
  });

  it("默认收起明细（截图/首屏不喧宾夺主）", () => {
    const html = renderToStaticMarkup(
      <RedTeamingBadge report={runRedTeam(FABRICATED)} />,
    );
    expect(html).toContain("拦截 1 条");
    expect(html).not.toContain("data-red-team-finding=");
  });
});

describe("QualityBoard × 红队（拦截必须影响评分与呈现）", () => {
  it("收起状态下也暴露拦截条数（不把拦截藏起来）", () => {
    const html = renderToStaticMarkup(<QualityBoard report={FABRICATED} />);
    expect(html).toContain("data-red-team-compact");
    expect(html).toContain("红队拦截 1 条");
  });

  it("展开后渲染完整的红队徽章与降级日志", () => {
    const html = renderToStaticMarkup(
      <QualityBoard report={FABRICATED} defaultOpen />,
    );
    expect(html).toContain("data-red-teaming");
    expect(html).toContain('data-red-team-downgrade="market#0"');
  });

  it("被拦截的「已核实」不再计入追溯度（拦截真正生效，而非装饰）", () => {
    const honest = renderToStaticMarkup(
      <QualityBoard
        report={report({}, [{ claim: "有来源的结论", label: "verified", source: "notion.so" }])}
        defaultOpen
      />,
    );
    const intercepted = renderToStaticMarkup(
      <QualityBoard report={FABRICATED} defaultOpen />,
    );

    // 追溯度提示点里的「已核实」占比：诚实版 100%，被拦截版 50%
    expect(honest).toContain("100% 结论已核实");
    expect(intercepted).toContain("50% 结论已核实");
  });

  it("干净报告不出现拦截提示", () => {
    const html = renderToStaticMarkup(
      <QualityBoard report={CLEAN} defaultOpen />,
    );
    expect(html).not.toContain("data-red-team-compact");
    expect(html).toContain('data-red-team-blocked="0"');
  });
});
