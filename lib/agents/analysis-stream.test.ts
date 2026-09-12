import { describe, it, expect } from "vitest";
import { createAnalysisStream } from "./analysis-stream";
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
  it("输出完整事件序列，且以 done 收尾、bus 为 SSE wire 格式", async () => {
    const stream = createAnalysisStream(parseProductBrief({ name: "X" }), {
      provider: stubProvider(["竞", "品"]),
    });
    const { raw, events } = await readEvents(stream);

    expect(raw).toContain("data: ");
    expect(raw.trimEnd().endsWith('data: {"type":"done"}')).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "agent:start",
      "agent:token",
      "agent:token",
      "agent:done",
      "done",
    ]);
    const doneEvent = events[3];
    expect(doneEvent).toMatchObject({
      type: "agent:done",
      agentId: "market",
      output: "竞品",
    });
  });

  it("provider 流抛错时转为 error 事件，仍以 done 收尾（不崩溃）", async () => {
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
    });
    const { events } = await readEvents(stream);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      agentId: "market",
      message: "供流失败",
    });
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });
});
