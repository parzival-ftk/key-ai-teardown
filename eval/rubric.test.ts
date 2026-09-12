import { describe, it, expect } from "vitest";
import { RUBRIC, overallScore } from "./rubric";

describe("overallScore（加权聚合）", () => {
  it("按权重加权平均并四舍五入", () => {
    // 80*.25 + 70*.25 + 90*.30 + 60*.20 = 76.5 → 77
    expect(
      overallScore({ coverage: 80, evidence: 70, insight: 90, actionability: 60 }),
    ).toBe(77);
  });

  it("缺失维度时按参与维度重新归一化（不把缺评当 0）", () => {
    expect(overallScore({ coverage: 100 })).toBe(100);
    expect(overallScore({ insight: 50 })).toBe(50);
  });

  it("分数越界被夹取到 [0,100]", () => {
    expect(overallScore({ coverage: 150 })).toBe(100);
    expect(overallScore({ coverage: -20 })).toBe(0);
  });

  it("非有限值被忽略；全无有效维度返回 0", () => {
    expect(overallScore({ coverage: NaN, evidence: Infinity })).toBe(0);
    expect(overallScore({ note: 99 })).toBe(0);
  });

  it("RUBRIC 维度 id 唯一且权重为正", () => {
    const ids = RUBRIC.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RUBRIC.every((d) => d.weight > 0)).toBe(true);
  });
});
