import { describe, it, expect } from "vitest";
import {
  COMPARISON_AGENT_ID,
  productAgentId,
  runComparison,
} from "./run-comparison";
import type { Agent } from "@/lib/types/agent";
import type { AgentEvent } from "@/lib/types/events";
import type { LLMProvider } from "@/lib/llm/provider";
import { parseCompareBrief } from "@/lib/types/compare";

function fakeProvider(reply: string): LLMProvider {
  return {
    id: "fake",
    model: "fake",
    async chat() {
      return { content: reply, model: "fake" };
    },
    async *chatStream() {
      yield reply;
    },
  };
}

/** 轻量单 Agent 取代完整编队，聚焦编排逻辑（编队本身另有 e2e 覆盖） */
function echoAgent(id: string): Agent {
  return {
    id,
    name: id,
    description: "",
    async run(_brief, ctx) {
      for await (const delta of ctx.provider.chatStream([], {})) {
        ctx.emit({ type: "agent:token", agentId: id, delta });
      }
      return { agentId: id, output: `报告-${id}`, evidence: [], failed: false };
    },
  };
}

const compareBrief = parseCompareBrief({
  products: [{ name: "A" }, { name: "B" }],
});

describe("runComparison（对比矩阵编排）", () => {
  it("每个产品各跑一遍编队，产物按输入同序，再产出对比结果", async () => {
    const outcome = await runComparison(
      compareBrief,
      {
        provider: fakeProvider("对比表正文"),
        agents: [echoAgent("market"), echoAgent("synthesis")],
      },
      () => {},
    );

    expect(outcome.products).toHaveLength(2);
    expect(outcome.products.map((p) => p.product.name)).toEqual(["A", "B"]);
    expect(outcome.products[0].sections.map((s) => s.agentId)).toEqual([
      "market",
      "synthesis",
    ]);
    expect(outcome.comparison.failed).toBe(false);
    expect(outcome.comparison.output).toBe("对比表正文");
  });

  it("多产品事件用命名空间区分，对比官单独发事件", async () => {
    const events: AgentEvent[] = [];
    await runComparison(
      compareBrief,
      { provider: fakeProvider("x"), agents: [echoAgent("market")] },
      (e) => events.push(e),
    );

    const startedIds = new Set(
      events
        .filter((e) => e.type === "agent:start")
        .map((e) => (e.type === "agent:start" ? e.agentId : "")),
    );
    expect(startedIds.has(productAgentId(0, "market"))).toBe(true);
    expect(startedIds.has(productAgentId(1, "market"))).toBe(true);
    expect(startedIds.has(COMPARISON_AGENT_ID)).toBe(true);
    // 对比官不发顶层 done（由 stream 层统一发）
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("对比官上游失败时标记 failed 并保留各产品结果，整体不抛出", async () => {
    const failing: LLMProvider = {
      id: "f",
      model: "f",
      async chat() {
        return { content: "", model: "f" };
      },
      async *chatStream() {
        yield "";
        throw new Error("上游失败");
      },
    };
    const outcome = await runComparison(
      compareBrief,
      { provider: failing, agents: [echoAgent("market")] },
      () => {},
    );
    expect(outcome.products).toHaveLength(2);
    expect(outcome.comparison.failed).toBe(true);
    expect(outcome.comparison.error).toContain("上游失败");
  });
});
