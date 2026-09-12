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
    // 流式 token 会按围栏安全边界合并，故断言拼接结果而非逐片
    const streamed = events
      .filter((e) => e.type === "agent:token")
      .map((e) => (e.type === "agent:token" ? e.delta : ""))
      .join("");
    expect(streamed).toBe("竞品");
    expect(events.every((e) => e.type === "agent:token")).toBe(true);
  });

  it("流式阶段不把结构化元数据块吐给用户（只发正文）", async () => {
    const raw = '正文X```json\n{"confidence":50}\n```';
    const events: AgentEvent[] = [];
    const result = await createMarketAgent().run(
      parseProductBrief({ name: "X" }),
      { provider: stubProvider([raw]), emit: (e) => events.push(e) },
    );

    const streamed = events
      .filter((e) => e.type === "agent:token")
      .map((e) => (e.type === "agent:token" ? e.delta : ""))
      .join("");

    expect(streamed).toBe("正文X");
    expect(streamed).not.toContain("json");
    expect(result.output).toBe("正文X");
  });

  it("解析结尾 JSON 块，填充 confidence/evidence 并从正文剥离（E2）", async () => {
    const raw = [
      "结论正文",
      "```json",
      '{"confidence":70,"evidence":[{"claim":"C","label":"inferred"}]}',
      "```",
    ].join("\n");
    const agent = createMarketAgent();
    const result = await agent.run(parseProductBrief({ name: "X" }), {
      provider: stubProvider([raw]),
      emit: () => {},
    });

    expect(result.output).toBe("结论正文");
    expect(result.confidence).toBe(70);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].label).toBe("inferred");
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
