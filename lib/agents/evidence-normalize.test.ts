import { describe, it, expect } from "vitest";
import { normalizeEvidence } from "./structured-output";
import { createMarketAgent } from "./market";
import { parseProductBrief } from "@/lib/types/brief";
import type { Evidence } from "@/lib/types/agent";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * W1 · 可信度不变量 + 输入追溯。
 * `verified` 必须能被本次输入机械核验（source 非空且是 inputText 子串），否则降级 inferred。
 */

const INPUT_TEXT = [
  "协作白板",
  "面向远程团队的实时协作白板，官网 https://board.example.com 。",
  "远程团队需要一个能异步评论的白板。",
].join("\n");

function stubProvider(chunks: string[]): LLMProvider {
  return {
    id: "stub",
    model: "stub",
    async chat() {
      return { content: chunks.join(""), model: "stub" };
    },
    async *chatStream() {
      for (const c of chunks) yield c;
    },
  };
}

describe("normalizeEvidence（纯函数）", () => {
  it("verified 且 source 为空 → 降级为 inferred", () => {
    const out = normalizeEvidence(
      [{ claim: "市场增长很快", label: "verified" }],
      INPUT_TEXT,
    );
    expect(out).toEqual([{ claim: "市场增长很快", label: "inferred" }]);
  });

  it("verified 且 source 不是输入文本子串 → 降级为 inferred", () => {
    const out = normalizeEvidence(
      [
        {
          claim: "已占据 40% 市场份额",
          label: "verified",
          source: "https://third-party.example.org/report",
        },
      ],
      INPUT_TEXT,
    );
    expect(out[0].label).toBe("inferred");
    // 原始 source 保留（供 UI 追溯模型给出的引用）
    expect(out[0].source).toBe("https://third-party.example.org/report");
  });

  it("verified 且 source 是输入文本子串 → 保持 verified", () => {
    const out = normalizeEvidence(
      [
        {
          claim: "官网地址为 board.example.com",
          label: "verified",
          source: "https://board.example.com",
        },
      ],
      INPUT_TEXT,
    );
    expect(out[0].label).toBe("verified");
  });

  it("source 为空白字符串视为无来源 → verified 降级", () => {
    const out = normalizeEvidence(
      [{ claim: "有据可依", label: "verified", source: "   " }],
      INPUT_TEXT,
    );
    expect(out[0].label).toBe("inferred");
  });

  it("inferred / missing 不受影响", () => {
    const input: Evidence[] = [
      { claim: "推测项", label: "inferred" },
      { claim: "缺失项", label: "missing", source: "https://nowhere.example" },
    ];
    const out = normalizeEvidence(input, INPUT_TEXT);
    expect(out.map((e) => e.label)).toEqual(["inferred", "missing"]);
  });

  it("空输入文本时，任何 verified 都无据可依 → 全部降级", () => {
    const out = normalizeEvidence(
      [{ claim: "A", label: "verified", source: "https://x.example" }],
      "",
    );
    expect(out[0].label).toBe("inferred");
  });

  it("空证据数组 → 空数组", () => {
    expect(normalizeEvidence([], INPUT_TEXT)).toEqual([]);
  });

  it("纯函数：不修改入参数组与其元素", () => {
    const input: Evidence[] = [
      { claim: "A", label: "verified", source: "https://not-in-input.example" },
    ];
    normalizeEvidence(input, INPUT_TEXT);
    expect(input[0].label).toBe("verified");
    expect(input).toHaveLength(1);
  });

  it("幂等：对已归一的输出再跑一次结果不变", () => {
    const once = normalizeEvidence(
      [{ claim: "A", label: "verified" }],
      INPUT_TEXT,
    );
    const twice = normalizeEvidence(once, INPUT_TEXT);
    expect(twice).toEqual(once);
  });
});

describe("framework-agent 接线（归一化在真实 run 路径生效）", () => {
  it("假引用（source 不在 brief 输入文本中）被自动降为「推测」，真引用保持", async () => {
    const raw = [
      "结论正文",
      "```json",
      JSON.stringify({
        confidence: 70,
        evidence: [
          {
            claim: "官网是 board.example.com",
            label: "verified",
            source: "https://board.example.com",
          },
          {
            claim: "已占据 40% 市场份额",
            label: "verified",
            source: "https://third-party.example.org/report",
          },
        ],
      }),
      "```",
    ].join("\n");

    const brief = parseProductBrief({
      name: "协作白板",
      description:
        "面向远程团队的实时协作白板，官网 https://board.example.com 。",
      rawText: "远程团队需要一个能异步评论的白板。",
    });

    const result = await createMarketAgent().run(brief, {
      provider: stubProvider([raw]),
      emit: () => {},
    });

    expect(result.output).toBe("结论正文");
    expect(result.evidence.map((e) => e.label)).toEqual(["verified", "inferred"]);
    expect(result.evidence[0].source).toBe("https://board.example.com");
  });

  it("无元数据块时证据为空，不报错", async () => {
    const result = await createMarketAgent().run(
      parseProductBrief({ name: "X" }),
      { provider: stubProvider(["纯文本结论"]), emit: () => {} },
    );
    expect(result.evidence).toEqual([]);
  });
});
