import type { Agent } from "@/lib/types/agent";

/**
 * 编排图工具（纯函数，零运行时依赖 —— 可被客户端安全引用，也可被测试直接驱动）。
 *
 * 从 orchestrator 抽出（W13）：**依赖解析只有一处实现**，
 * 既供运行时调度用，也供 DAG 拓扑配置的「防漂移测试」用 —— 
 * 两条路径共用同一份规则，拓扑图才不可能与真实编队脱节。
 */

/**
 * 解析每个 Agent 的依赖 id 列表。
 * 显式 `agent.dependsOn` 优先；否则并行组视为无依赖、其余依赖其**之前声明的全部 Agent**（旧语义）。
 * 依赖了不存在的 Agent → 抛错（fail-closed，静默忽略会掩盖配置 bug）。
 */
export function resolveDependencies(
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

/**
 * 拓扑分层：返回每一层的 id（层内可并行，层间串行）。
 * 与 orchestrator 的调度循环同构 —— 依赖环或缺失依赖时抛错（收敛判据，杜绝挂起）。
 */
export function planLayers(
  ids: string[],
  dependencies: Map<string, string[]>,
): string[][] {
  const done = new Set<string>();
  const remaining = new Set(ids);
  const layers: string[][] = [];

  while (remaining.size > 0) {
    const ready = ids.filter(
      (id) =>
        remaining.has(id) &&
        (dependencies.get(id) ?? []).every((dep) => done.has(dep)),
    );
    if (ready.length === 0) {
      throw new Error(
        `编排无法推进（存在依赖环或缺失依赖）：${[...remaining].join(", ")}`,
      );
    }
    layers.push(ready);
    for (const id of ready) {
      done.add(id);
      remaining.delete(id);
    }
  }
  return layers;
}

/**
 * 传递归约：删掉「可经其它边到达」的冗余边。**保留可达性**，只去冗余。
 *
 * 为什么需要：本项目串行 Agent 依赖「全部前序」，原始边是 31 条（对下游逐个扇入），
 * 直接画是毛线团。归约后只剩骨干边（11 条），图可读且语义等价。
 * 原始依赖仍完整保留在节点的 `dependsOn` 里（供 Inspector 展示，不做删改）。
 */
export function transitiveReduction(
  dependencies: Map<string, string[]>,
): Array<{ from: string; to: string }> {
  const ancestorsMemo = new Map<string, Set<string>>();

  const ancestorsOf = (id: string): Set<string> => {
    const cached = ancestorsMemo.get(id);
    if (cached) return cached;
    const acc = new Set<string>();
    // 先占位：即便输入意外成环也不会无限递归
    ancestorsMemo.set(id, acc);
    for (const dep of dependencies.get(id) ?? []) {
      acc.add(dep);
      for (const a of ancestorsOf(dep)) acc.add(a);
    }
    return acc;
  };

  const edges: Array<{ from: string; to: string }> = [];
  for (const [id, deps] of dependencies) {
    for (const dep of deps) {
      const redundant = deps.some(
        (other) => other !== dep && ancestorsOf(other).has(dep),
      );
      if (!redundant) edges.push({ from: dep, to: id });
    }
  }
  return edges;
}
