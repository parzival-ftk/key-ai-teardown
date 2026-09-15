import type { AgentEvent } from "@/lib/types/events";

/**
 * DAG 节点状态机（W13，**纯函数**）。
 *
 * 设计：把「SSE 事件 → 节点状态」做成纯 reducer，React 只负责把它接进 useReducer。
 * 好处：状态转换可以脱离 React / DOM / 网络单测（本仓库组件层测试薄，状态逻辑必须自证）。
 *
 * 状态集合：pending（未开始）| running（进行中）| completed（已完成）| failed（失败）。
 */

export type DagNodeStatus = "pending" | "running" | "completed" | "failed";

export interface DagNodeState {
  status: DagNodeStatus;
  /** 流式产出（token 累积，done 时以完整输出覆盖） */
  output: string;
  /** 产出字符数（直播页展示的进度量） */
  chars: number;
  confidence?: number;
  startedAt: number | null;
  endedAt: number | null;
}

export type DagState = Record<string, DagNodeState>;

export interface DagProgress {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

export function createInitialDagState(nodeIds: string[]): DagState {
  const state: DagState = {};
  for (const id of nodeIds) {
    state[id] = {
      status: "pending",
      output: "",
      chars: 0,
      startedAt: null,
      endedAt: null,
    };
  }
  return state;
}

const patch = (
  state: DagState,
  id: string,
  next: DagNodeState,
): DagState => ({ ...state, [id]: next });

/**
 * 纯状态转移：SSE 事件 → 节点状态。
 * 未知 agentId、或事件不改变状态时**返回原引用** —— 避免无意义的重渲染。
 */
export function applyDagEvent(
  state: DagState,
  event: AgentEvent,
  now: number,
): DagState {
  switch (event.type) {
    case "agent:start": {
      const node = state[event.agentId];
      if (!node || node.status === "running") return state;
      return patch(state, event.agentId, {
        ...node,
        status: "running",
        startedAt: node.startedAt ?? now,
        output: "",
        chars: 0,
      });
    }
    case "agent:token": {
      const node = state[event.agentId];
      if (!node) return state;
      const output = node.output + event.delta;
      return patch(state, event.agentId, { ...node, output, chars: output.length });
    }
    case "agent:done": {
      const node = state[event.agentId];
      if (!node) return state;
      const output = event.output || node.output;
      return patch(state, event.agentId, {
        ...node,
        status: "completed",
        output,
        chars: output.length,
        confidence: event.confidence,
        endedAt: now,
      });
    }
    case "error": {
      if (!event.agentId) return state;
      const node = state[event.agentId];
      if (!node) return state;
      return patch(state, event.agentId, {
        ...node,
        status: "failed",
        endedAt: now,
      });
    }
    default:
      return state;
  }
}

/** 节点耗时（毫秒）：未开始 → null；进行中 → 至今；已结束 → 起止差 */
export function nodeElapsedMs(node: DagNodeState, now: number): number | null {
  if (node.startedAt === null) return null;
  return (node.endedAt ?? now) - node.startedAt;
}

export type DagEdgeFlow = "idle" | "flowing" | "settled";

/**
 * 边的流动状态：
 * - `flowing`（父已完成、子运行中）→ 直播时画流动光效
 * - `settled`（两端都已完成）→ 静态高亮
 * - 其余 `idle`
 */
export function edgeFlow(
  edge: { from: string; to: string },
  state: DagState,
): DagEdgeFlow {
  const from = state[edge.from];
  const to = state[edge.to];
  if (!from || !to) return "idle";
  if (to.status === "running" && from.status === "completed") return "flowing";
  if (from.status === "completed" && to.status === "completed") return "settled";
  return "idle";
}

/** 汇总进度（直播页头部展示「已完成 x/10」） */
export function summarizeDag(state: DagState): DagProgress {
  const progress: DagProgress = {
    total: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const node of Object.values(state)) {
    progress.total += 1;
    progress[node.status] += 1;
  }
  return progress;
}
