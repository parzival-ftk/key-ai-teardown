import { describe, it, expect } from "vitest";
import { RUBRIC, overallScore } from "./rubric";
import { EVAL_DIMENSIONS } from "@/lib/eval/dimensions";

const [CONSISTENCY, JTBD, TRACEABILITY, PRD] = EVAL_DIMENSIONS.map((d) => d.id);

describe("overallScore（加权聚合）", () => {
  it("按权重加权平均并四舍五入", () => {
    // consistency .25 + jtbd .25 + traceability .30 + prd .20
    // 80*.25 + 70*.25 + 90*.30 + 60*.20 = 76.5 → 77
    expect(
      overallScore({
        [CONSISTENCY]: 80,
        [JTBD]: 70,
        [TRACEABILITY]: 90,
        [PRD]: 60,
      }),
    ).toBe(77);
  });

  it("缺失维度时按参与维度重新归一化（不把缺评当 0）", () => {
    expect(overallScore({ [TRACEABILITY]: 100 })).toBe(100);
    expect(overallScore({ [CONSISTENCY]: 50 })).toBe(50);
  });

  it("分数越界被夹取到 [0,100]", () => {
    expect(overallScore({ [CONSISTENCY]: 150 })).toBe(100);
    expect(overallScore({ [CONSISTENCY]: -20 })).toBe(0);
  });

  it("非有限值被忽略；全无有效维度返回 0", () => {
    expect(
      overallScore({ [CONSISTENCY]: NaN, [TRACEABILITY]: Infinity }),
    ).toBe(0);
    expect(overallScore({ note: 99 })).toBe(0);
  });

  it("RUBRIC 维度 id 唯一、权重为正，且与规格要求的四维一致（W14）", () => {
    const ids = RUBRIC.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RUBRIC.every((d) => d.weight > 0)).toBe(true);
    expect([...ids].sort()).toEqual([
      "consistency",
      "jtbd",
      "prd",
      "traceability",
    ]);
    expect(RUBRIC).toBe(EVAL_DIMENSIONS);
  });
});
