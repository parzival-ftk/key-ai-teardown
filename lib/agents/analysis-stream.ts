import { runAnalysis } from "./orchestrator";
import { createMarketAgent } from "./market";
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
  /** 默认仅竞品分析师（Wave 1）；Wave 2 起注入完整编队 */
  agents?: Agent[];
  signal?: AbortSignal;
}

export function createAnalysisStream(
  brief: ProductBrief,
  options: AnalysisStreamOptions,
): ReadableStream<Uint8Array> {
  const { provider, signal } = options;
  const agents = options.agents ?? [createMarketAgent()];
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(serializeAgentEvent(event)));
      };
      try {
        await runAnalysis(brief, { provider, agents, signal }, emit);
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
