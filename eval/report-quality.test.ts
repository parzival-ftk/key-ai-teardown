import { describe, it, expect } from "vitest";
import { displayWidth, padDisplay, qualityGate, renderQualityTable } from "./report";
import type { EvalRun } from "./baseline";
import { EVAL_DIMENSIONS } from "@/lib/eval/dimensions";

const [D1, D2, D3, D4] = EVAL_DIMENSIONS.map((d) => d.id);

const run: EvalRun = {
  createdAt: "2026-01-01",
  model: "m",
  results: [
    { id: "a", name: "Notion", scores: { [D1]: 90, [D2]: 85, [D3]: 95, [D4]: 80 }, overall: 89 },
    { id: "b", name: "Figma", scores: { [D1]: 60, [D2]: 70, [D3]: 50, [D4]: 55 }, overall: 58 },
  ],
};

describe("displayWidth / padDisplay（CJK 对齐）", () => {
  it("宽字符按 2 列计", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("样例")).toBe(4);
    expect(displayWidth("样例a")).toBe(5);
  });

  it("按显示宽度补齐；已超宽不裁剪", () => {
    expect(padDisplay("样例", 6)).toBe("样例  ");
    expect(padDisplay("abcdef", 3)).toBe("abcdef");
  });
});

describe("qualityGate", () => {
  it("平均分 ≥ 阈值且无样例低于阈值 → 通过", () => {
    const good: EvalRun = {
      ...run,
      results: run.results.map((r) => ({ ...r, overall: 85 })),
    };
    expect(qualityGate(good, 80)).toMatchObject({ passed: true, average: 85, failedSamples: [] });
  });

  it("有样例低于阈值 → 不通过并点名", () => {
    const gate = qualityGate(run, 80);
    expect(gate.passed).toBe(false);
    expect(gate.failedSamples).toEqual(["Figma"]);
    expect(gate.threshold).toBe(80);
  });

  it("空运行 → 不通过（不把「没跑」当通过）", () => {
    expect(qualityGate({ createdAt: "", model: "", results: [] }).passed).toBe(false);
  });
});

describe("renderQualityTable", () => {
  const table = renderQualityTable(run, 80);

  it("含标题、四个维度名与综合/门禁列", () => {
    expect(table).toContain("质量评估（门禁阈值 80 分）");
    for (const dim of EVAL_DIMENSIONS) expect(table).toContain(dim.nameEn);
    expect(table).toContain("Composite");
    expect(table).toContain("Gate");
  });

  it("逐样例给分与门禁判定", () => {
    expect(table).toContain("Notion");
    expect(table).toContain("PASS");
    expect(table).toContain("Figma");
    expect(table).toContain("FAIL");
    expect(table).toContain("门禁未过：Figma 低于 80 分。");
  });

  it("维度缺分显示 —（不假装 0 分）", () => {
    const partial = renderQualityTable(
      { ...run, results: [{ id: "x", name: "X", scores: { [D1]: 70 }, overall: 70 }] },
      80,
    );
    expect(partial).toContain("—");
    expect(partial.split("\n").some((l) => l.includes("—"))).toBe(true);
  });
});
