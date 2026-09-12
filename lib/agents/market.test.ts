import { describe, it, expect } from "vitest";
import {
  createMarketAgent,
  buildMarketMessages,
  MARKET_AGENT_ID,
} from "./market";
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

describe("竞品分析师 Agent", () => {
  it("buildMarketMessages 产出 system + user，且带上产品信息", () => {
    const messages = buildMarketMessages(
      parseProductBrief({ name: "Notion", description: "协作文档工具" }),
    );
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("Notion");
    expect(messages[1].content).toContain("协作文档工具");
  });

  it("共创模式使用不同的引导语", () => {
    const teardown = buildMarketMessages(
      parseProductBrief({ name: "X", mode: "teardown" }),
    );
    const coCreate = buildMarketMessages(
      parseProductBrief({ name: "X", mode: "co-create" }),
    );
    expect(teardown[1].content).toContain("待分析的产品信息");
    expect(coCreate[1].content).toContain("尚未落地");
  });

  it("run 流式产出、汇聚 output 并发 token 事件", async () => {
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
