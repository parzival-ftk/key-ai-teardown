import { describe, it, expect } from "vitest";
import { runAnalysis } from "./orchestrator";
import type { Agent } from "@/lib/types/agent";
import type { AgentEvent } from "@/lib/types/events";
import type { LLMProvider } from "@/lib/llm/provider";
import { parseProductBrief } from "@/lib/types/brief";

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

function tokenAgent(id: string): Agent {
  return {
    id,
    name: id,
    description: id,
    async run(_brief, ctx) {
      let output = "";
      for await (const delta of ctx.provider.chatStream([], {})) {
        output += delta;
        ctx.emit({ type: "agent:token", agentId: id, delta });
      }
      return { agentId: id, output, evidence: [], failed: false };
    },
  };
}

const brief = parseProductBrief({ name: "Test" });

describe("runAnalysis 编排", () => {
  it("按顺序发出 start → token… → done", async () => {
    const events: AgentEvent[] = [];
    await runAnalysis(
      brief,
      { provider: stubProvider(["你", "好"]), agents: [tokenAgent("a")] },
      (e) => events.push(e),
    );
    expect(events.map((e) => e.type)).toEqual([
      "agent:start",
      "agent:token",
      "agent:token",
      "agent:done",
    ]);
    expect(events[0]).toMatchObject({ type: "agent:start", agentId: "a" });
    expect(events[events.length - 1]).toMatchObject({
      type: "agent:done",
      agentId: "a",
      output: "你好",
    });
  });

  it("单 Agent 失败不中断整体，继续后续 Agent", async () => {
    const failing: Agent = {
      id: "bad",
      name: "bad",
      description: "",
      async run() {
        throw new Error("boom");
      },
    };
    const events: AgentEvent[] = [];
    const results = await runAnalysis(
      brief,
      {
        provider: stubProvider(["ok"]),
        agents: [failing, tokenAgent("good")],
      },
      (e) => events.push(e),
    );

    expect(results[0].failed).toBe(true);
    expect(results[0].error).toBe("boom");
    expect(results[1].failed).toBe(false);
    expect(results[1].output).toBe("ok");
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({
      type: "agent:done",
      agentId: "good",
    });
  });
});
