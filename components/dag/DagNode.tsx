"use client";

import type { CSSProperties } from "react";
import type { DagNodeConfig } from "@/lib/orchestration/dagConfig";
import {
  nodeElapsedMs,
  type DagNodeState,
  type DagNodeStatus,
} from "@/lib/orchestration/dag-state";

/** 状态 → 视觉（图标 / 圆点 / 边框） */
const STATUS_META: Record<
  DagNodeStatus,
  { label: string; icon: string; dot: string; ring: string }
> = {
  pending: {
    label: "待执行",
    icon: "○",
    dot: "bg-gray-300 dark:bg-gray-600",
    ring: "border-gray-200 dark:border-gray-800",
  },
  running: {
    label: "进行中",
    icon: "◐",
    dot: "bg-blue-500 animate-pulse",
    ring: "border-blue-400 dark:border-blue-600",
  },
  completed: {
    label: "已完成",
    icon: "✓",
    dot: "bg-green-500",
    ring: "border-green-300 dark:border-green-800",
  },
  failed: {
    label: "失败",
    icon: "✕",
    dot: "bg-red-500",
    ring: "border-red-400 dark:border-red-800",
  },
};

export interface DagNodeProps {
  node: DagNodeConfig;
  state: DagNodeState | undefined;
  /** 当前时刻（毫秒）——由父组件在渲染时传入，避免为「耗时」单独起定时器 */
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
  /** 绝对定位（由布局数学计算，不做 DOM 测量） */
  style: CSSProperties;
}

export function DagNode({
  node,
  state,
  now,
  selected,
  onSelect,
  style,
}: DagNodeProps) {
  const status: DagNodeStatus = state?.status ?? "pending";
  const meta = STATUS_META[status];
  const chars = state?.chars ?? 0;
  const elapsed = state ? nodeElapsedMs(state, now) : null;
  const confidence = state?.confidence;

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      style={style}
      data-dag-node={node.id}
      data-dag-status={status}
      aria-label={`${node.name}：${meta.label}`}
      className={`absolute flex flex-col justify-between overflow-hidden rounded-xl border bg-white p-2.5 text-left transition hover:shadow-md dark:bg-gray-950 ${
        meta.ring
      } ${selected ? "ring-2 ring-blue-500" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        <span className="truncate text-sm font-medium">{node.name}</span>
        <span className="ml-auto shrink-0 text-xs text-gray-400">{meta.icon}</span>
      </div>
      <code className="truncate font-mono text-[10px] text-gray-400">
        {node.id}
      </code>
      <div
        className="flex items-center gap-2.5 text-[11px] tabular-nums text-gray-500 dark:text-gray-400"
        data-dag-metrics
      >
        <span>{chars} 字符</span>
        <span>{elapsed === null ? "—" : `${(elapsed / 1000).toFixed(1)}s`}</span>
        {typeof confidence === "number" && <span>置信 {confidence}</span>}
      </div>
    </button>
  );
}
