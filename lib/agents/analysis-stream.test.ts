import { describe, it, expect } from "vitest";
import { createAnalysisStream } from "./analysis-stream";
import { createMarketAgent } from "./market";
import { deserializeAgentEvent, type AgentEvent } from "@/lib/types/events";
import { parseProductBrief } from "@/lib/types/brief";
import type { LLMProvider } from "@/lib/llm/provider";

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

async function readEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<{ raw: string; events: AgentEvent[] }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  const events = raw
    .split("\n")
    .map((line) => deserializeAgentEvent(line))
    .filter((e): e is AgentEvent => e !== null);
  return { raw, events };
}

describe("createAnalysisStream（SSE 集成）", () => {
  it("注入单 Agent 时输出完整事件序列，以 done 收尾、格式为 SSE wire", async () => {
    const stream = createAnalysisStream(parseProductBrief({ name: "X" }), {
      provider: stubProvider(["竞", "品"]),
      agents: [createMarketAgent()],
      parallel: [],
    });
    const { raw, events } = await readEvents(stream);

    expect(raw).toContain("data: ");
    expect(raw.trimEnd().endsWith('data: {"type":"done"}')).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "agent:start",
      "agent:token",
      "agent:done",
      "done",
    ]);
    expect(events[2]).toMatchObject({
      type: "agent:done",
      agentId: "market",
      output: "竞品",
    });
  });

  it("默认编队：3 个分析 Agent 并行，访谈官与后续 Agent 串行，最后以 done 收尾", async () => {
    const stream = createAnalysisStream(parseProductBrief({ name: "X" }), {
      provider: stubProvider(["x"]),
    });
    const { events } = await readEvents(stream);

    const starts = events
      .filter((e) => e.type === "agent:start")
      .map((e) => (e.type === "agent:start" ? e.agentId : ""));
    expect(starts).toEqual([
      "market",
      "user-research",
      "business",
      "interviewer",
      "devils-advocate",
      "synthesis",
      "prd",
    ]);

    // W4 画像先行：访谈官移出并行组，其 start 必须晚于研究员（并行组）的 done。
    // 注意：本条**只证明调度时序**（访谈官确实排在研究员之后、能拿到 priorResults）；
    // 画像真的被注入 prompt 由 analysis-e2e.test.ts 的真实 HTTP 断言覆盖，此处不做内容断言。
    const researchDone = events.findIndex(
      (e) => e.type === "agent:done" && e.agentId === "user-research",
    );
    const interviewerStart = events.findIndex(
      (e) => e.type === "agent:start" && e.agentId === "interviewer",
    );
    expect(researchDone).toBeGreaterThanOrEqual(0);
    expect(interviewerStart).toBeGreaterThan(researchDone);

    // 辩论/综合在分析组之后（串行）：devils-advocate 的 start 晚于 market 的 done
    const marketDone = events.findIndex(
      (e) => e.type === "agent:done" && e.agentId === "market",
    );
    const devilStart = events.findIndex(
      (e) => e.type === "agent:start" && e.agentId === "devils-advocate",
    );
    expect(marketDone).toBeGreaterThanOrEqual(0);
    expect(devilStart).toBeGreaterThan(marketDone);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("provider 抛错时转为 error 事件，仍以 done 收尾（不崩溃）", async () => {
    const failing: LLMProvider = {
      id: "stub",
      model: "stub",
      async chat() {
        throw new Error("x");
      },
      async *chatStream() {
        yield "";
        throw new Error("供流失败");
      },
    };
    const stream = createAnalysisStream(parseProductBrief({ name: "X" }), {
      provider: failing,
      agents: [createMarketAgent()],
      parallel: [],
    });
    const { events } = await readEvents(stream);

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });
});
