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

  it("parallel 列表中的 Agent 并发启动（所有 start 早于第一个 done）", async () => {
    const events: AgentEvent[] = [];
    await runAnalysis(
      brief,
      {
        provider: stubProvider(["x"]),
        agents: [tokenAgent("a"), tokenAgent("b"), tokenAgent("c")],
        parallel: ["a", "b", "c"],
      },
      (e) => events.push(e),
    );

    const startIndices = events
      .map((e, i) => (e.type === "agent:start" ? i : -1))
      .filter((i) => i >= 0);
    const firstDoneIndex = events.findIndex((e) => e.type === "agent:done");

    expect(startIndices).toHaveLength(3);
    // 三个 Agent 的 start 都发生在第一个 done 之前 → 说明是并发而非逐个串行
    expect(Math.max(...startIndices)).toBeLessThan(firstDoneIndex);
  });

  it("结果按 agents 原顺序返回（与完成先后无关）", async () => {
    const results = await runAnalysis(
      brief,
      {
        provider: stubProvider(["x"]),
        agents: [tokenAgent("a"), tokenAgent("b"), tokenAgent("c")],
        parallel: ["a", "b", "c"],
      },
      () => {},
    );
    expect(results.map((r) => r.agentId)).toEqual(["a", "b", "c"]);
  });

  it("混合模式：并行组先跑完，串行组的 start 在其后", async () => {
    const events: AgentEvent[] = [];
    await runAnalysis(
      brief,
      {
        provider: stubProvider(["x"]),
        agents: [tokenAgent("p1"), tokenAgent("p2"), tokenAgent("s1")],
        parallel: ["p1", "p2"],
      },
      (e) => events.push(e),
    );

    const order = events
      .filter((e) => e.type === "agent:start")
      .map((e) => (e.type === "agent:start" ? e.agentId : ""));
    expect(order).toEqual(["p1", "p2", "s1"]);
  });
});
