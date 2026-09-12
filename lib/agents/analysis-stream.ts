import { runAnalysis } from "./orchestrator";
import { createMarketAgent, MARKET_AGENT_ID } from "./market";
import {
  createUserResearchAgent,
  USER_RESEARCH_AGENT_ID,
} from "./user-research";
import { createBusinessAgent, BUSINESS_AGENT_ID } from "./business";
import { createInterviewerAgent, INTERVIEWER_AGENT_ID } from "./interviewer";
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
  /** 默认完整编队（竞品 / 用户 / 商业模式 / 访谈官）；可注入以测试 */
  agents?: Agent[];
  /** 默认四个分析 Agent 全并行 */
  parallel?: string[];
  signal?: AbortSignal;
}

/** 默认编队：四个分析 Agent */
export function createDefaultAgents(): Agent[] {
  return [
    createMarketAgent(),
    createUserResearchAgent(),
    createBusinessAgent(),
    createInterviewerAgent(),
  ];
}

/** 默认并行组：四个分析 Agent 同时跑（spec §5 的「并行分析」） */
export const DEFAULT_PARALLEL_AGENT_IDS: string[] = [
  MARKET_AGENT_ID,
  USER_RESEARCH_AGENT_ID,
  BUSINESS_AGENT_ID,
  INTERVIEWER_AGENT_ID,
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
