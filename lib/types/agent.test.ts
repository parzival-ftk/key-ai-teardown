import { describe, it, expect } from "vitest";
import { EvidenceLabelSchema, AgentResultSchema } from "./agent";

describe("Evidence 证据标签", () => {
  it("只接受 verified / inferred / missing", () => {
    expect(EvidenceLabelSchema.safeParse("verified").success).toBe(true);
    expect(EvidenceLabelSchema.safeParse("inferred").success).toBe(true);
    expect(EvidenceLabelSchema.safeParse("missing").success).toBe(true);
    expect(EvidenceLabelSchema.safeParse("maybe").success).toBe(false);
  });
});

describe("AgentResult 契约", () => {
  it("默认 evidence 为空、failed 为 false", () => {
    const result = AgentResultSchema.parse({ agentId: "market", output: "内容" });
    expect(result.evidence).toEqual([]);
    expect(result.failed).toBe(false);
  });

  it("置信度必须在 0-100 区间", () => {
    expect(
      AgentResultSchema.safeParse({ agentId: "x", output: "y", confidence: -1 })
        .success,
    ).toBe(false);
    expect(
      AgentResultSchema.safeParse({ agentId: "x", output: "y", confidence: 101 })
        .success,
    ).toBe(false);
    expect(
      AgentResultSchema.safeParse({ agentId: "x", output: "y", confidence: 80 })
        .success,
    ).toBe(true);
  });

  it("携带证据标签列表", () => {
    const result = AgentResultSchema.parse({
      agentId: "market",
      output: "竞品 A 市占率领先",
      evidence: [
        { claim: "竞品 A 市占率领先", label: "inferred" },
        { claim: "官方数据显示 40%", label: "verified", source: "https://x.com" },
      ],
    });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[1].source).toBe("https://x.com");
  });
});
