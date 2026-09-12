import type { Agent } from "@/lib/types/agent";
import type { ProductBrief } from "@/lib/types/brief";
import type { ChatMessage } from "@/lib/llm/provider";

/**
 * 竞品分析师（Wave 1 单 Agent 版）。
 * Wave 2 会接入完整的「波特五力 / SWOT」框架提示词库，本版先跑通闭环。
 */

export const MARKET_AGENT_ID = "market";

const SYSTEM_PROMPT = `你是 Key 的「竞品分析师」，一位有十年经验的产品经理。

基于用户提供的产品信息，输出一份结构化的竞品分析，要求：

1. 先用一句话总结当前的竞争格局。
2. 列出 3-5 个主要竞品，每个给出：名称 / 定位 / 核心优势 / 主要弱点。
3. 分析该产品的竞争壁垒（护城河）来自哪里。
4. 指出最值得警惕的一个威胁。

规则：
- 使用中文、Markdown 输出，条理清晰。
- 不要编造具体的市场规模、营收、用户数等数据；无法确知的信息请明确标注「（推测）」。
- 只做分析，不要写代码，不要输出与竞品分析无关的内容。`;

export function buildMarketMessages(brief: ProductBrief): ChatMessage[] {
  const context =
    brief.mode === "co-create"
      ? "以下是用户的一个产品想法（尚未落地），请把它当作潜在竞品来推演市场格局："
      : "以下是待分析的产品信息：";

  const userContent = [
    context,
    `产品名称：${brief.name}`,
    brief.description ? `产品描述：${brief.description}` : "",
    brief.rawText ? `补充资料：${brief.rawText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

export function createMarketAgent(): Agent {
  return {
    id: MARKET_AGENT_ID,
    name: "竞品分析师",
    description: "分析竞品格局、竞争壁垒与威胁",
    async run(brief, ctx) {
      const messages = buildMarketMessages(brief);
      let output = "";
      for await (const delta of ctx.provider.chatStream(messages, {
        signal: ctx.signal,
      })) {
        output += delta;
        ctx.emit({ type: "agent:token", agentId: MARKET_AGENT_ID, delta });
      }
      return {
        agentId: MARKET_AGENT_ID,
        output,
        evidence: [],
        failed: false,
      };
    },
  };
}
