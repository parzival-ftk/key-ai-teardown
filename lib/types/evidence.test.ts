import { describe, it, expect } from "vitest";
import {
  summarizeEvidence,
  evidenceTotal,
  traceablePercent,
} from "./evidence";

describe("summarizeEvidence（证据计数 · W2）", () => {
  it("按标签分类计数", () => {
    const stats = summarizeEvidence([
      { claim: "a", label: "verified", source: "s" },
      { claim: "b", label: "inferred" },
      { claim: "c", label: "missing" },
      { claim: "d", label: "verified", source: "t" },
    ]);
    expect(stats).toEqual({ verified: 2, inferred: 1, missing: 1 });
  });

  it("空数组归零", () => {
    expect(summarizeEvidence([])).toEqual({
      verified: 0,
      inferred: 0,
      missing: 0,
    });
  });
});

describe("总览统计（W3）", () => {
  it("evidenceTotal 汇总各标签", () => {
    expect(evidenceTotal({ verified: 2, inferred: 1, missing: 1 })).toBe(4);
    expect(evidenceTotal({ verified: 0, inferred: 0, missing: 0 })).toBe(0);
  });

  it("traceablePercent 计算可追溯占比并四舍五入", () => {
    expect(traceablePercent({ verified: 1, inferred: 1, missing: 2 })).toBe(25);
    expect(traceablePercent({ verified: 2, inferred: 1, missing: 0 })).toBe(67);
    expect(traceablePercent({ verified: 3, inferred: 0, missing: 0 })).toBe(100);
  });

  it("无证据时不除零，返回 0", () => {
    expect(traceablePercent({ verified: 0, inferred: 0, missing: 0 })).toBe(0);
  });
});
