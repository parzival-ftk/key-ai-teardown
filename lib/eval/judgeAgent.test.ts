import { describe, it, expect } from "vitest";
import {
  buildJudgeMessages,
  parseJudgeOutput,
  scoreEvaluation,
  type EvaluableReport,
} from "./judgeAgent";
import { EVAL_DIMENSIONS } from "./dimensions";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import type { Evidence } from "@/lib/types/evidence";

const GOOD_PRD =
  "用户故事：As a 新用户… 验收标准：Given 首次登录 When 选择模板 Then 生成示例页。" +
  "成功指标：北极星为 5 分钟内容创建率。功能范围：MVP 含模板库，明确不做 SSO。" +
  "发布就绪清单：文档/数据/体验/稳定性。风险与依赖：中文模板供给是依赖项。";

const GOOD_USERS =
  "画像 Persona-A（知识管家）；JTBD functional / emotional / social 三层齐备。";

const GOOD_INTERVIEW = "摩擦点：模板太多反而看花眼。最普遍的抱怨：移动端体验弱。";

/** 用真实报告段定义拼一份完整报告；overrides 可显式传空串来模拟缺段 */
function fullReport(overrides: Record<string, string> = {}): EvaluableReport {
  return {
    name: "Notion",
    sections: REPORT_SECTIONS.map((spec) => ({
      agentId: spec.agentId,
      output: overrides[spec.agentId] ?? "（分析正文）",
    })),
  };
}

function goodReport(evidence?: Evidence[]): EvaluableReport {
  const report = fullReport({
    "user-research": GOOD_USERS,
    interviewer: GOOD_INTERVIEW,
    "devils-advocate": "被质疑的假设：壁垒可能被抹平。",
    rebuttal: "逐条答辩：部分接受，修正结论。",
    synthesis: "分歧裁决：采纳质疑，下调置信度。",
    prd: GOOD_PRD,
  });
  if (evidence) report.sections[0].evidence = evidence;
  return report;
}

describe("compositeScore（加权聚合）", () => {
  it("按权重加权；缺失维度重新归一化", () => {
    // traceability 权重 0.3，其余 0.25/0.25/0.2
    expect(
      compositeScoreAll({ consistency: 100, jtbd: 100, traceability: 0, prd: 100 }),
    ).toBe(70);
    expect(compositeScoreAll({ consistency: 100 })).toBe(100);
  });

  it("越界分数被夹取；全无有效维度返回 0", () => {
    expect(compositeScoreAll({ consistency: 240 })).toBe(100);
    expect(compositeScoreAll({ consistency: -50 })).toBe(0);
    expect(compositeScoreAll({ unknown: 99 })).toBe(0);
  });
});

// 便于阅读的薄封装
function compositeScoreAll(scores: Record<string, number>): number {
  let weighted = 0;
  let weightSum = 0;
  for (const dim of EVAL_DIMENSIONS) {
    const v = scores[dim.id];
    if (typeof v !== "number") continue;
    weighted += Math.min(100, Math.max(0, v)) * dim.weight;
    weightSum += dim.weight;
  }
  return weightSum === 0 ? 0 : Math.round(weighted / weightSum);
}

describe("scoreEvaluation · 边界情况", () => {
  it("空报告 → 全维度 0 分 + critical 建议 + 门禁不过", () => {
    const result = scoreEvaluation({ sections: [] });
    expect(result.composite).toBe(0);
    expect(result.dimensions).toHaveLength(EVAL_DIMENSIONS.length);
    expect(result.dimensions.every((d) => d.score === 0)).toBe(true);
    expect(
      result.suggestions.some(
        (s) => s.severity === "critical" && s.text.includes("报告为空"),
      ),
    ).toBe(true);
    expect(result.gate.passed).toBe(false);
    expect(result.source).toBe("heuristic");
  });

  it("伪造引用（verified 但无来源）→ 追溯度降级 + 重罚 + critical 建议", () => {
    const evidence: Evidence[] = [
      { claim: "A", label: "verified" }, // 伪造：无 source
      { claim: "B", label: "verified", source: "notion.so 官网" },
      { claim: "C", label: "inferred" },
    ];
    const result = scoreEvaluation(goodReport(evidence));
    const trace = result.dimensions.find((d) => d.id === "traceability")!;

    expect(trace.downgraded).toBe(true);
    // 可追溯 1/3 ≈ 33 → 伪造 1 条再扣 15 → 18
    expect(trace.score).toBe(18);
    expect(
      result.suggestions.some(
        (s) => s.severity === "critical" && s.text.includes("伪造引用"),
      ),
    ).toBe(true);
  });

  it("合法证据 → 追溯度 = 已核实占比，不降级", () => {
    const evidence: Evidence[] = [
      { claim: "A", label: "verified", source: "notion.so 官网" },
      { claim: "B", label: "inferred" },
    ];
    const result = scoreEvaluation(goodReport(evidence));
    const trace = result.dimensions.find((d) => d.id === "traceability")!;
    expect(trace.downgraded).toBe(false);
    expect(trace.score).toBe(50);
    expect(trace.note).toContain("50% 结论已核实");
  });

  it("缺 PRD 段 → PRD 维 0 分 + critical 建议", () => {
    const result = scoreEvaluation(fullReport({ prd: "" }));
    const prd = result.dimensions.find((d) => d.id === "prd")!;
    expect(prd.score).toBe(0);
    expect(prd.note).toContain("缺少 PRD");
    expect(
      result.suggestions.some(
        (s) => s.dimension === "prd" && s.severity === "critical",
      ),
    ).toBe(true);
  });

  it("辩论链不完整 → 自洽性扣分并给出 warn", () => {
    const report = fullReport({
      "devils-advocate": "",
      rebuttal: "",
      synthesis: "结论并列，无裁决字样。",
    });
    const result = scoreEvaluation(report);
    const consistency = result.dimensions.find((d) => d.id === "consistency")!;
    expect(consistency.score).toBeLessThan(70);
    expect(
      result.suggestions.some(
        (s) => s.dimension === "consistency" && s.severity === "warn",
      ),
    ).toBe(true);
  });
});

describe("scoreEvaluation · 正常路径", () => {
  it("高质量报告 → 综合分 ≥ 80、门禁通过、含 strength 亮点", () => {
    const evidence: Evidence[] = [
      { claim: "A", label: "verified", source: "notion.so 官网" },
      { claim: "B", label: "verified", source: "notion.so 设计说明" },
    ];
    const result = scoreEvaluation(goodReport(evidence));

    expect(result.composite).toBeGreaterThanOrEqual(80);
    expect(result.gate.passed).toBe(true);
    expect(result.gate.threshold).toBe(80);
    expect(result.highlights.some((h) => h.kind === "strength")).toBe(true);
  });

  it("门禁阈值可覆盖", () => {
    const result = scoreEvaluation(fullReport(), { threshold: 99 });
    expect(result.gate.threshold).toBe(99);
    expect(result.gate.passed).toBe(false);
  });

  it("低分报告给出 weakness 亮点", () => {
    const result = scoreEvaluation(fullReport({ prd: "", "user-research": "" }));
    expect(result.highlights.some((h) => h.kind === "weakness")).toBe(true);
  });
});

describe("LLM-as-a-judge 接口", () => {
  it("buildJudgeMessages 覆盖全部维度 id 与中英文名", () => {
    const messages = buildJudgeMessages({
      id: "x",
      name: "示例",
      reportText: "报告正文",
    });
    expect(messages).toHaveLength(2);
    const user = messages[1].content as string;
    for (const dim of EVAL_DIMENSIONS) {
      expect(user).toContain(dim.id);
      expect(user).toContain(dim.nameEn);
    }
    expect(user).toContain("报告正文");
  });

  it("parseJudgeOutput 容忍围栏 / 裸 JSON，忽略未知键", () => {
    const dims = EVAL_DIMENSIONS.map((d) => d.id);
    const payload = JSON.stringify({
      scores: { [dims[0]]: 88, unknown: 10 },
      rationale: { [dims[0]]: "结构完整" },
    });
    const fenced = parseJudgeOutput(`评审：\n\`\`\`json\n${payload}\n\`\`\``);
    expect(fenced?.scores[dims[0]]).toBe(88);
    expect(fenced?.scores.unknown).toBeUndefined();
    expect(fenced?.rationale[dims[0]]).toBe("结构完整");

    expect(parseJudgeOutput(payload)?.scores[dims[0]]).toBe(88);
  });

  it("无有效维度 → null（调用方降级，不抛错）", () => {
    expect(parseJudgeOutput("没有 JSON")).toBeNull();
    expect(parseJudgeOutput('{"scores":{"unknown":90}}')).toBeNull();
    expect(parseJudgeOutput('{"scores":{"consistency":"80"}}')).toBeNull();
  });
});
