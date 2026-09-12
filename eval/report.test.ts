import { describe, it, expect } from "vitest";
import {
  averageScore,
  renderComparisonTable,
  renderRunSummary,
} from "./report";
import type { EvalRun } from "./baseline";

describe("renderComparisonTable", () => {
  it("含表头与数据行；正 delta 带 +，无基线显示 —", () => {
    const table = renderComparisonTable([
      { id: "a", name: "A", current: 80, baseline: 70, delta: 10 },
      { id: "b", name: "B", current: 60, baseline: null, delta: null },
    ]);
    expect(table).toContain("| 样例 | 基线 | 当前 | 变化 |");
    expect(table).toContain("| A | 70 | 80 | +10 |");
    expect(table).toContain("| B | — | 60 | — |");
  });

  it("负 delta 带符号", () => {
    const table = renderComparisonTable([
      { id: "a", name: "A", current: 50, baseline: 60, delta: -10 },
    ]);
    expect(table).toContain("| A | 60 | 50 | -10 |");
  });
});

describe("averageScore / renderRunSummary", () => {
  const run: EvalRun = {
    createdAt: "2026-01-01",
    model: "m",
    results: [
      { id: "a", name: "A", scores: {}, overall: 80 },
      { id: "b", name: "B", scores: {}, overall: 61 },
    ],
  };

  it("平均分四舍五入", () => {
    expect(averageScore(run)).toBe(71); // (80+61)/2 = 70.5 → 71
  });

  it("空运行平均分为 0（不除零）", () => {
    expect(averageScore({ createdAt: "", model: "", results: [] })).toBe(0);
  });

  it("摘要含时间 / 模型 / 样例数 / 平均分", () => {
    const summary = renderRunSummary(run);
    expect(summary).toContain("模型：m");
    expect(summary).toContain("样例数：2");
    expect(summary).toContain("平均分：71");
  });

  it("模型缺省时给出占位而非空白", () => {
    expect(
      renderRunSummary({ createdAt: "", model: "", results: [] }),
    ).toContain("（未标注）");
  });
});
