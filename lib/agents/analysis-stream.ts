import { runAnalysis } from "./orchestrator";
import { createMarketAgent, MARKET_AGENT_ID } from "./market";
import {
  createUserResearchAgent,
  USER_RESEARCH_AGENT_ID,
} from "./user-research";
import { createBusinessAgent, BUSINESS_AGENT_ID } from "./business";
import {
  createVisualDesignAgent,
  VISUAL_DESIGN_AGENT_ID,
} from "./visual-design";
import { createUiCodeAgent, UI_CODE_AGENT_ID } from "./ui-code";
import { createInterviewerAgent } from "./interviewer";
import { createDevilsAdvocateAgent } from "./devils-advocate";
import { createRebuttalAgent } from "./rebuttal";
import { createSynthesisAgent } from "./synthesis";
import { createPrdAgent } from "./prd";
import type { Agent } from "@/lib/types/agent";
import type { ProductBrief } from "@/lib/types/brief";
import type { LLMProvider } from "@/lib/llm/provider";
import { serializeAgentEvent, type AgentEvent } from "@/lib/types/events";

/**
 * 分析流 —— 把编排过程封装成 SSE 的 ReadableStream。
 * 抽成独立单元（与 route handler 解耦），便于注入 stub provider 做集成测试。
 */

export interface AnalysisStreamOptions {
  provider: LLMProvider;
  /** 默认完整编队；可注入以测试 */
  agents?: Agent[];
  /** 默认并行组：五个分析 Agent；访谈官与后续辩论/综合 Agent 走串行 */
  parallel?: string[];
  signal?: AbortSignal;
}

/**
 * 默认编队（数组顺序即调度顺序）：
 *   market / user-research / business / visual-design / ui-code 五个分析 Agent 并行
 *   → 用户访谈官 → 反方质疑官 → 答辩官 → PM 综合官 → PRD 撰写官
 *
 * W4「画像先行」：用户访谈官不在并行组 —— 它要读到用户研究员已确立的 persona。
 *   W10 起该依赖由编排层**显式声明**（见 lib/agents/interviewer.ts 的 dependsOn），
 *   不再靠框架内按 agentId 筛——W4 有意留下的「依赖图债」已在此偿还。
 *
 * W10「真辩论」：质疑官（devils-advocate）→ 答辩官（rebuttal）→ 综合官（synthesis）
 *   构成串行链；综合官读质疑与答辩做裁决，分歧在报告「质疑答辩」段显式呈现。
 */
export function createDefaultAgents(): Agent[] {
  return [
    createMarketAgent(),
    createUserResearchAgent(),
    createInterviewerAgent(),
    createBusinessAgent(),
    createVisualDesignAgent(),
    createUiCodeAgent(),
    createDevilsAdvocateAgent(),
    createRebuttalAgent(),
    createSynthesisAgent(),
    createPrdAgent(),
  ];
}

/** 默认并行组：五个分析 Agent 同时跑（spec §5「并行分析」）；其余 Agent 串行 */
export const DEFAULT_PARALLEL_AGENT_IDS: string[] = [
  MARKET_AGENT_ID,
  USER_RESEARCH_AGENT_ID,
  BUSINESS_AGENT_ID,
  VISUAL_DESIGN_AGENT_ID,
  UI_CODE_AGENT_ID,
];

export function createAnalysisStream(
  brief: ProductBrief,
  options: AnalysisStreamOptions,
): ReadableStream<Uint8Array> {
  const { provider, signal } = options;
  const agents = options.agents ?? createDefaultAgents();
  const parallel = options.parallel ?? DEFAULT_PARALLEL_AGENT_IDS;
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(serializeAgentEvent(event)));
      };
      try {
        await runAnalysis(brief, { provider, agents, parallel, signal }, emit);
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "未知错误",
        });
      } finally {
        emit({ type: "done" });
        controller.close();
      }
    },
  });
}
