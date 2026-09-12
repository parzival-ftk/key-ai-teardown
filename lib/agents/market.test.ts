import { describe, it, expect } from "vitest";
import { createMarketAgent, MARKET_AGENT_ID } from "./market";
import { createUserResearchAgent, USER_RESEARCH_AGENT_ID } from "./user-research";
import { createBusinessAgent, BUSINESS_AGENT_ID } from "./business";
import type { LLMProvider } from "@/lib/llm/provider";
import type { AgentEvent } from "@/lib/types/events";
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

describe("三个分析 Agent", () => {
  it("各自的 id / name / 框架绑定正确", () => {
    expect(createMarketAgent()).toMatchObject({
      id: MARKET_AGENT_ID,
      name: "竞品分析师",
    });
    expect(createUserResearchAgent()).toMatchObject({
      id: USER_RESEARCH_AGENT_ID,
      name: "用户研究员",
    });
    expect(createBusinessAgent()).toMatchObject({
      id: BUSINESS_AGENT_ID,
      name: "商业模式分析师",
    });
  });

  it("run 流式产出并汇聚 output、发 token 事件", async () => {
    const events: AgentEvent[] = [];
    const agent = createMarketAgent();
    const result = await agent.run(parseProductBrief({ name: "X" }), {
      provider: stubProvider(["竞", "品"]),
      emit: (e) => events.push(e),
    });

    expect(result.output).toBe("竞品");
    expect(result.failed).toBe(false);
    expect(result.agentId).toBe(MARKET_AGENT_ID);
    expect(events).toEqual([
      { type: "agent:token", agentId: MARKET_AGENT_ID, delta: "竞" },
      { type: "agent:token", agentId: MARKET_AGENT_ID, delta: "品" },
    ]);
  });
});

describe("createFrameworkAgent 工厂", () => {
  it("空框架数组抛错", async () => {
    const { createFrameworkAgent } = await import("./framework-agent");
    expect(() =>
      createFrameworkAgent({
        id: "x",
        name: "x",
        description: "x",
        frameworks: [],
      }),
    ).toThrow();
  });
});
