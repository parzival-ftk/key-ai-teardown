import { describe, it, expect } from "vitest";
import {
  calculateWeightedScores,
  DEFAULT_WEIGHT,
  MAX_WEIGHT,
  type DimensionScore,
} from "./weighted-score";
import { RADAR_DIMENSION_IDS } from "@/lib/report/radar-dimensions";

/**
 * W20 · 动态加权与排名重算引擎单测。
 *
 * 三层判据：
 *  1) 数值正确 —— 加权综合分 = Σ(分×权) / Σ(权)，仍是 0–100 可比口径；
 *  2) 排名正确 —— 权重变化必须真的改变名次，且 Δ/名次变化符号自洽；
 *  3) 边界安全 —— 全 0 / 非法权重不能产生 NaN，必须降级为等权并给出诊断。
 */

/** 只用 3 个维度，便于手算期望值 */
const DIMS = ["a", "b", "c"];

const X: DimensionScore = { id: "x", label: "X 产品", scores: { a: 100, b: 0, c: 0 } };
const Y: DimensionScore = { id: "y", label: "Y 产品", scores: { a: 0, b: 100, c: 100 } };

describe("calculateWeightedScores（等权基准）", () => {
  it("不给权重时 weighted === baseline，Δ 与名次变化均为 0", () => {
    const r = calculateWeightedScores([X, Y], {}, DIMS);
    expect(r.fallback).toBe(false);
    for (const s of r.scores) {
      expect(s.weighted).toBe(s.baseline);
      expect(s.delta).toBe(0);
      expect(s.rank).toBe(s.baseRank);
      expect(s.rankDelta).toBe(0);
    }
  });

  it("等权综合分 = 各维度算术平均（缺失维度按 0）", () => {
    const r = calculateWeightedScores([X, Y], {}, DIMS);
    const byId = Object.fromEntries(r.scores.map((s) => [s.id, s]));
    expect(byId.x.weighted).toBe(33.3); // (100+0+0)/3
    expect(byId.y.weighted).toBe(66.7); // (0+100+100)/3
  });

  it("缺省权重时 effectiveWeights 覆盖全部生效维度且为 1", () => {
    const r = calculateWeightedScores([X], {}, DIMS);
    expect(r.effectiveWeights).toEqual({ a: 1, b: 1, c: 1 });
    expect(DEFAULT_WEIGHT).toBe(1);
  });
});

describe("calculateWeightedScores（加权与排名重算）", () => {
  it("加权综合分 = Σ(分×权)/Σ(权)", () => {
    const r = calculateWeightedScores([X, Y], { a: 3, b: 1, c: 1 }, DIMS);
    const byId = Object.fromEntries(r.scores.map((s) => [s.id, s]));
    expect(byId.x.weighted).toBe(60); // (100×3 + 0 + 0) / 5
    expect(byId.y.weighted).toBe(40); // (0 + 100 + 100) / 5
  });

  it("权重变化会真正改变名次，Δ 与名次变化符号自洽", () => {
    const r = calculateWeightedScores([X, Y], { a: 3, b: 1, c: 1 }, DIMS);
    const byId = Object.fromEntries(r.scores.map((s) => [s.id, s]));

    expect(byId.x.rank).toBe(1);
    expect(byId.x.baseRank).toBe(2);
    expect(byId.x.rankDelta).toBe(1); // 上升 1 名
    expect(byId.x.delta).toBeCloseTo(60 - 33.3, 1);

    expect(byId.y.rank).toBe(2);
    expect(byId.y.rankDelta).toBe(-1); // 下降 1 名
    expect(byId.y.delta).toBeCloseTo(40 - 66.7, 1);
  });

  it("结果按排名升序排列", () => {
    const r = calculateWeightedScores([X, Y], { a: 3, b: 1, c: 1 }, DIMS);
    expect(r.scores.map((s) => s.rank)).toEqual([1, 2]);
    expect(r.scores.map((s) => s.id)).toEqual(["x", "y"]);
  });

  it("同分并列名次（竞争排名），后续名次跳过", () => {
    const same1: DimensionScore = { id: "m", scores: { a: 50, b: 50, c: 50 } };
    const same2: DimensionScore = { id: "n", scores: { a: 50, b: 50, c: 50 } };
    const low: DimensionScore = { id: "z", scores: { a: 10, b: 10, c: 10 } };
    const r = calculateWeightedScores([same1, same2, low], {}, DIMS);
    const ranks = Object.fromEntries(r.scores.map((s) => [s.id, s.rank]));
    expect(ranks.m).toBe(1);
    expect(ranks.n).toBe(1);
    expect(ranks.z).toBe(3);
  });

  it("确定性：同一输入两次结果完全一致", () => {
    const a = calculateWeightedScores([X, Y], { a: 2 }, DIMS);
    const b = calculateWeightedScores([X, Y], { a: 2 }, DIMS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("calculateWeightedScores（边界与降级）", () => {
  it("权重全为 0 → 降级为等权，fallback=true 且有诊断，不产生 NaN", () => {
    const r = calculateWeightedScores([X, Y], { a: 0, b: 0, c: 0 }, DIMS);
    expect(r.fallback).toBe(true);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    const byId = Object.fromEntries(r.scores.map((s) => [s.id, s]));
    expect(byId.x.weighted).toBe(33.3);
    expect(Number.isNaN(byId.x.weighted)).toBe(false);
    expect(r.effectiveWeights).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("非法权重（NaN / Infinity / 负数）→ 降级为等权并诊断", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -2]) {
      const r = calculateWeightedScores([X, Y], { a: bad }, DIMS);
      expect(r.fallback).toBe(true);
      expect(r.diagnostics.join()).toContain("非法");
      expect(r.effectiveWeights.a).toBe(1);
    }
  });

  it("越界权重被夹取到上限（不降级），并给出诊断", () => {
    const r = calculateWeightedScores([X, Y], { a: 50 }, DIMS);
    expect(r.fallback).toBe(false);
    expect(r.effectiveWeights.a).toBe(MAX_WEIGHT);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    const byId = Object.fromEntries(r.scores.map((s) => [s.id, s]));
    expect(byId.x.weighted).toBe(83.3); // 100×10 / (10+1+1)
  });

  it("未知维度权重被忽略并记诊断", () => {
    const r = calculateWeightedScores([X, Y], { a: 2, nope: 5 }, DIMS);
    expect(r.effectiveWeights.nope).toBeUndefined();
    expect(r.diagnostics.join()).toContain("nope");
  });

  it("分数越界被夹取到 0–100，非有限值按 0", () => {
    const weird: DimensionScore = {
      id: "w",
      scores: { a: 150, b: -20, c: Number.NaN },
    };
    const r = calculateWeightedScores([weird], {}, DIMS);
    expect(r.scores[0].weighted).toBe(33.3); // (100 + 0 + 0) / 3
  });

  it("空输入 → 空结果，不抛错", () => {
    expect(calculateWeightedScores([], {}, DIMS).scores).toEqual([]);
    expect(() => calculateWeightedScores([], {})).not.toThrow();
  });

  it("label 缺省时回退为 id", () => {
    const r = calculateWeightedScores([{ id: "q", scores: { a: 30 } }], {}, DIMS);
    expect(r.scores[0].label).toBe("q");
  });
});

describe("calculateWeightedScores（默认维度集合）", () => {
  it("缺省维度集合为雷达图的 6 个维度，未给分的维度按 0 计入分母", () => {
    const r = calculateWeightedScores([
      { id: "only-ux", scores: { ux: 60 } },
    ]);
    // 6 个维度的等权平均：(60 + 0×5) / 6
    expect(r.scores[0].weighted).toBe(10);
    expect(Object.keys(r.effectiveWeights).sort()).toEqual(
      [...RADAR_DIMENSION_IDS].sort(),
    );
  });
});
