import { describe, it, expect } from "vitest";
import { renderReportText, runEval } from "./run";
import type { AgentResult } from "@/lib/types/agent";
import type { LLMProvider } from "@/lib/llm/provider";
import { parseProductBrief } from "@/lib/types/brief";

const ANALYSIS_TEXT = "分析正文：该产品机会在于 X，风险在于 Y。";
const JUDGE_JSON =
  '{"scores":{"coverage":80,"evidence":70,"insight":90,"actionability":60},"rationale":{"coverage":"结构完整"}}';

/** 同一 provider 同时扮演编队与 judge：chatStream → 分析正文，chat → judge 回复 */
function fakeProvider(judgeReply: string): LLMProvider {
  return {
    id: "fake",
    model: "fake-model",
    async chat() {
      return { content: judgeReply, model: "fake-model" };
    },
    async *chatStream() {
      yield ANALYSIS_TEXT;
    },
  };
}

describe("runEval", () => {
  it("跑完每个 brief 并聚合为 EvalRun（含 overall 与 model）", async () => {
    const run = await runEval({
      briefs: [{ id: "a", brief: parseProductBrief({ name: "A" }) }],
      analysisProvider: fakeProvider(JUDGE_JSON),
      judgeProvider: fakeProvider(JUDGE_JSON),
      modelLabel: "fake-model",
      now: () => "2026-01-01T00:00:00.000Z",
    });

    expect(run.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(run.model).toBe("fake-model");
    expect(run.results).toHaveLength(1);
    // 80*.25 + 70*.25 + 90*.30 + 60*.20 = 76.5 → 77
    expect(run.results[0]).toMatchObject({ id: "a", name: "A", overall: 77 });
  });

  it("judge 输出不可解析时降级为 0 分（不抛错）", async () => {
    const run = await runEval({
      briefs: [{ id: "a", brief: parseProductBrief({ name: "A" }) }],
      analysisProvider: fakeProvider("非 JSON 输出"),
      judgeProvider: fakeProvider("非 JSON 输出"),
      now: () => "t",
    });
    expect(run.results[0].overall).toBe(0);
    expect(run.results[0].scores).toEqual({});
  });

  it("多个 brief 各自出分", async () => {
    const run = await runEval({
      briefs: [
        { id: "a", brief: parseProductBrief({ name: "A" }) },
        { id: "b", brief: parseProductBrief({ name: "B" }) },
      ],
      analysisProvider: fakeProvider(JUDGE_JSON),
      judgeProvider: fakeProvider(JUDGE_JSON),
      now: () => "t",
    });
    expect(run.results.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("renderReportText", () => {
  it("跳过失败 / 空段落，并用报告展示标题", () => {
    const results: AgentResult[] = [
      { agentId: "market", output: "市场内容", evidence: [], failed: false },
      { agentId: "business", output: "", evidence: [], failed: false },
      {
        agentId: "synthesis",
        output: "综合",
        evidence: [],
        failed: true,
        error: "boom",
      },
    ];
    const text = renderReportText(results);
    expect(text).toContain("市场与竞争格局");
    expect(text).toContain("市场内容");
    expect(text).not.toContain("商业模式");
    expect(text).not.toContain("综合");
  });
});
