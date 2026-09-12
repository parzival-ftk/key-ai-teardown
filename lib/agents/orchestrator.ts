import type { Agent, AgentContext, AgentResult } from "@/lib/types/agent";
import type { ProductBrief } from "@/lib/types/brief";
import type { AgentEvent } from "@/lib/types/events";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * 编排层 —— 按 DAG 调度 Agent，把过程实时转为事件流。
 *
 * 核心不变量（spec §8）：任何单点失败都不能让整个分析会话崩溃 ——
 * 单个 Agent 抛错时发 error 事件、记录失败的 AgentResult，并继续后续 Agent。
 */

export interface OrchestratorOptions {
  provider: LLMProvider;
  /** Wave 1 为单 Agent；Wave 2 起支持多 Agent 并行调度 */
  agents: Agent[];
  signal?: AbortSignal;
}

export async function runAnalysis(
  brief: ProductBrief,
  options: OrchestratorOptions,
  emit: (event: AgentEvent) => void,
): Promise<AgentResult[]> {
  const { provider, agents, signal } = options;
  const results: AgentResult[] = [];

  for (const agent of agents) {
    emit({ type: "agent:start", agentId: agent.id, name: agent.name });
    const ctx: AgentContext = { provider, emit, signal };
    try {
      const result = await agent.run(brief, ctx);
      emit({
        type: "agent:done",
        agentId: agent.id,
        output: result.output,
        confidence: result.confidence,
      });
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      emit({ type: "error", agentId: agent.id, message });
      results.push({
        agentId: agent.id,
        output: "",
        evidence: [],
        failed: true,
        error: message,
      });
    }
  }

  return results;
}
