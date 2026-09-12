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
  /** 默认并行组：三个分析 Agent（用户访谈官已在 W4 移入串行组以复用研究员画像） */
  parallel?: string[];
  signal?: AbortSignal;
}

/**
 * 默认编队（数组顺序即调度顺序）：
 *   market / user-research / business / visual-design / ui-code 五个分析 Agent 并行
 *   → 用户访谈官 → 反方质疑官 → PM 综合官 → PRD 撰写官
 *
 * W4「画像先行」：用户访谈官移入串行组 —— 它要读到用户研究员已确立的 persona，
 * 必须等并行组全部完成后才跑（串行组天然能看到「此前所有已完成结果」）。
 *
 * ⚠️ 依赖图的债在此（W4 有意留债，计划在 W10 偿还）：
 *   访谈官 → 研究员 这层依赖目前是**隐式**的：靠 interviewer 框架从 priorResults 里
 *   按 agentId 筛，而非编排层声明的 dependsOn。orchestrator 只有「并行组 / 串行组」
 *   两档，任何串行 Agent 都能看到全部前序结果，无法表达「只依赖某一个」。
 *   W10 会把 orchestrator 升级为显式依赖图，届时这里应改为声明式依赖。
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
    createSynthesisAgent(),
    createPrdAgent(),
  ];
}

/** 默认并行组：五个分析 Agent 同时跑（spec §5「并行分析」）；访谈官在 W4 移入串行组 */
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
