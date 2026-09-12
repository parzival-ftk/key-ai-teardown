import { describe, it, expect } from "vitest";
import { compareRuns, parseRun, serializeRun, type EvalRun } from "./baseline";

const run: EvalRun = {
  createdAt: "2026-01-01T00:00:00.000Z",
  model: "m",
  results: [
    { id: "a", name: "A", scores: { coverage: 80 }, overall: 80 },
    { id: "b", name: "B", scores: { coverage: 60 }, overall: 60 },
  ],
};

describe("serializeRun / parseRun", () => {
  it("往返一致", () => {
    expect(parseRun(serializeRun(run))).toEqual(run);
  });

  it("坏输入一律返回 null（调用方视为无基线）", () => {
    expect(parseRun(null)).toBeNull();
    expect(parseRun("")).toBeNull();
    expect(parseRun("not json")).toBeNull();
    expect(parseRun("{}")).toBeNull();
    expect(parseRun('{"results":"x"}')).toBeNull();
  });

  it("过滤形状不符的 results 项，保留合法项", () => {
    const parsed = parseRun(
      '{"createdAt":"t","model":"m","results":[{"id":"a"},{"id":"b","name":"B","overall":5,"scores":{}}]}',
    );
    expect(parsed?.results.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("compareRuns", () => {
  it("无基线时 baseline / delta 均为 null", () => {
    const rows = compareRuns(run, null);
    expect(rows.map((r) => [r.id, r.baseline, r.delta])).toEqual([
      ["a", null, null],
      ["b", null, null],
    ]);
  });

  it("有基线时按 id 对齐并计算 delta；基线缺该样例则为 null", () => {
    const baseline: EvalRun = {
      createdAt: "t0",
      model: "m",
      results: [{ id: "a", name: "A", scores: {}, overall: 70 }],
    };
    const rows = compareRuns(run, baseline);
    expect(rows[0]).toMatchObject({
      id: "a",
      baseline: 70,
      current: 80,
      delta: 10,
    });
    expect(rows[1]).toMatchObject({ id: "b", baseline: null, delta: null });
  });
});
