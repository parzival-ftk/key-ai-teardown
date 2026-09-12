import { describe, it, expect } from "vitest";
import { summarizeEvidence } from "./evidence";

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
