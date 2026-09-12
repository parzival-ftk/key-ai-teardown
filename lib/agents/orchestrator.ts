import type { Agent, AgentContext, AgentResult } from "@/lib/types/agent";
import type { ProductBrief } from "@/lib/types/brief";
import type { AgentEvent } from "@/lib/types/events";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * 编排层 —— 按依赖图调度 Agent，把过程实时转为事件流。
 *
 * 核心不变量（spec §8）：任何单点失败都不能让整个分析会话崩溃 ——
 * 单个 Agent 抛错时发 error 事件、记录失败的 AgentResult，并继续后续 Agent。
 *
 * W10：由「并行组 / 串行组」两档升级为**显式依赖图**（拓扑分层调度）：
 * - 每个 Agent 的依赖 = 显式 `agent.dependsOn`（若声明）
 *   → 否则并行组视为无依赖、串行 Agent 依赖其**之前声明的全部 Agent**（保持旧语义）。
 * - 每轮取「依赖全部完成」的 Agent **并行**执行，直到全部完成；priorResults 只含该 Agent 的依赖项。
 * - 无环时必然终止；出现依赖环则 ready 为空 → 显式抛错（收敛判据，杜绝挂起）。
 */

export interface OrchestratorOptions {
  provider: LLMProvider;
  /** 要执行的 Agent（数组顺序决定结果顺序，也决定串行 Agent 的隐式依赖顺序） */
  agents: Agent[];
  /**
   * 无显式 dependsOn 时，这些 id 的 Agent 视为无依赖（并行执行）；
   * 未列出的按数组顺序「依赖其之前声明的全部 Agent」串行。
   */
  parallel?: string[];
  signal?: AbortSignal;
}

/** 解析每个 Agent 的依赖 id 列表（显式声明优先，否则回退到旧语义） */
function resolveDependencies(
  agents: Agent[],
  parallelIds: Set<string>,
): Map<string, string[]> {
  const knownIds = new Set(agents.map((a) => a.id));
  const dependencies = new Map<string, string[]>();

  for (const [index, agent] of agents.entries()) {
    let deps: string[];
    if (agent.dependsOn) {
      const missing = agent.dependsOn.filter((id) => !knownIds.has(id));
      if (missing.length > 0) {
        // fail-closed：依赖不存在的 Agent 是配置错误，静默忽略会掩盖 bug
        throw new Error(
          `Agent「${agent.id}」依赖了不存在的 Agent：${missing.join(", ")}`,
        );
      }
      deps = agent.dependsOn;
    } else if (parallelIds.has(agent.id)) {
      deps = [];
    } else {
      deps = agents.slice(0, index).map((a) => a.id);
    }
    dependencies.set(agent.id, deps);
  }
  return dependencies;
}

export async function runAnalysis(
  brief: ProductBrief,
  options: OrchestratorOptions,
  emit: (event: AgentEvent) => void,
): Promise<AgentResult[]> {
  const { provider, agents, signal } = options;
  const parallelIds = new Set(options.parallel ?? []);
  const results = new Map<string, AgentResult>();
  const dependencies = resolveDependencies(agents, parallelIds);

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

  // 拓扑分层：每轮并行执行所有「依赖已就绪」的 Agent，直到全部完成。
  const remaining = new Set(agents.map((a) => a.id));
  while (remaining.size > 0) {
    const ready = agents.filter(
      (a) =>
        remaining.has(a.id) &&
        dependencies.get(a.id)!.every((dep) => results.has(dep)),
    );
    if (ready.length === 0) {
      throw new Error(
        `编排无法推进（存在依赖环或缺失依赖）：${[...remaining].join(", ")}`,
      );
    }
    const settled = await Promise.all(
      ready.map((a) =>
        runOne(
          a,
          dependencies.get(a.id)!.map((dep) => results.get(dep)!),
        ),
      ),
    );
    ready.forEach((a, i) => results.set(a.id, settled[i]));
    for (const a of ready) remaining.delete(a.id);
  }

  // 按 agents 原顺序返回，保证下游消费稳定
  return agents.map((a) => results.get(a.id)!);
}
