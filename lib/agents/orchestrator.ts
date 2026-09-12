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
  /** 要执行的 Agent（数组顺序决定结果顺序） */
  agents: Agent[];
  /** 这些 id 的 Agent 并行执行（前三分析并行）；未列出的按顺序串行 */
  parallel?: string[];
  signal?: AbortSignal;
}

export async function runAnalysis(
  brief: ProductBrief,
  options: OrchestratorOptions,
  emit: (event: AgentEvent) => void,
): Promise<AgentResult[]> {
  const { provider, agents, signal } = options;
  const parallelIds = new Set(options.parallel ?? []);
  const results = new Map<string, AgentResult>();

  const runOne = async (
    agent: Agent,
    priorResults: AgentResult[],
  ): Promise<AgentResult> => {
    emit({ type: "agent:start", agentId: agent.id, name: agent.name });
    const ctx: AgentContext = { provider, emit, signal, priorResults };
    try {
      const result = await agent.run(brief, ctx);
      emit({
        type: "agent:done",
        agentId: agent.id,
        output: result.output,
        confidence: result.confidence,
        evidence: result.evidence.length > 0 ? result.evidence : undefined,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      emit({ type: "error", agentId: agent.id, message });
      return {
        agentId: agent.id,
        output: "",
        evidence: [],
        failed: true,
        error: message,
      };
    }
  };

  // 并行组：同时启动，互不阻塞（彼此看不到对方结果）
  const parallelAgents = agents.filter((a) => parallelIds.has(a.id));
  if (parallelAgents.length > 0) {
    const settled = await Promise.all(parallelAgents.map((a) => runOne(a, [])));
    parallelAgents.forEach((a, i) => results.set(a.id, settled[i]));
  }

  // 串行组：逐个执行，且能看到此前所有已完成的结果（辩论 / 综合 / PRD 走这里）
  for (const agent of agents) {
    if (parallelIds.has(agent.id)) continue;
    const priorResults = agents
      .filter((a) => results.has(a.id))
      .map((a) => results.get(a.id)!);
    results.set(agent.id, await runOne(agent, priorResults));
  }

  // 按 agents 原顺序返回，保证下游消费稳定
  return agents.map((a) => results.get(a.id)!);
}
