"use client";

import { useMemo, useState } from "react";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import {
  buildThoughtTree,
  THOUGHT_KIND_LABEL,
  type ThoughtTreeNode,
  type ThoughtNodeKind,
} from "@/lib/agents/thought-tree";
import {
  formatDuration,
  type ReasoningStep,
} from "@/lib/agents/reasoning-parser";

/**
 * 多 Agent 思维树视图（W23）。
 *
 * 与 `ReasoningTimeline`（线性时间轴）互补：把同一份推理步骤还原成**层次分支**——
 * 独立分析并列、质疑挂到被质疑的分支之下、修正收敛为结论。
 *
 * 交互：
 *   - 点击节点 → 展开/收起该节点的 Thought / Observation 细节；
 *   - 同时回调 `onSelectNode(node)`，由宿主（报告页）据 `node.reportAnchor` 高亮关联区块。
 *
 * 组件只接 props（steps），不自己读存储 —— 与 W21/W22 同一条纪律。
 */

const KIND_STYLE: Record<ThoughtNodeKind, { badge: string; dot: string }> = {
  root: {
    badge: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
    dot: "bg-gray-500",
  },
  branch: {
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    dot: "bg-blue-500",
  },
  // 博弈节点：琥珀色（区别于普通分支的红/蓝）
  conflict: {
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  decision: {
    badge: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    dot: "bg-green-500",
  },
};

/** agent id → 展示名（复用报告章节 owner，避免与 sections.ts 漂移） */
const AGENT_DISPLAY: Record<string, string> = Object.fromEntries(
  REPORT_SECTIONS.map((s) => [s.agentId, s.owner]),
);

export interface ThoughtTreeViewProps {
  steps: ReasoningStep[];
  /** 节点点击回调（用于高亮报告区块）；展开细节由组件内部处理 */
  onSelectNode?: (node: ThoughtTreeNode) => void;
  /** 默认展开的节点 id */
  defaultExpandedIds?: string[];
}

export function ThoughtTreeView({
  steps,
  onSelectNode,
  defaultExpandedIds = [],
}: ThoughtTreeViewProps) {
  const tree = useMemo(() => buildThoughtTree(steps), [steps]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedIds),
  );

  function activateNode(node: ThoughtTreeNode) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    onSelectNode?.(node);
  }

  if (steps.length === 0) {
    return (
      <section
        data-thought-tree
        className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
      >
        <p data-thought-tree-empty className="text-sm text-gray-400">
          暂无推理记录。
        </p>
      </section>
    );
  }

  const renderNode = (node: ThoughtTreeNode, depth: number): React.ReactNode => {
    const open = expanded.has(node.id);
    const style = KIND_STYLE[node.kind];
    const label =
      node.kind === "root"
        ? "推理起点"
        : AGENT_DISPLAY[node.agentId ?? ""] ?? node.agentLabel ?? node.agentId ?? "未标注";
    return (
      <li
        key={node.id}
        data-thought-node={node.id}
        data-thought-kind={node.kind}
        data-thought-agent={node.agentId ?? ""}
        data-thought-depth={depth}
        data-thought-conflict={node.kind === "conflict" ? "true" : undefined}
        className="relative"
      >
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`}
          />
          <button
            type="button"
            data-thought-node-toggle
            aria-expanded={open}
            onClick={() => activateNode(node)}
            className="flex flex-1 flex-wrap items-center gap-2 text-left"
          >
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
              {label}
            </span>
            {node.kind !== "root" && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {THOUGHT_KIND_LABEL[node.kind]}
              </span>
            )}
            {node.kind !== "root" && (
              <span className="text-sm text-gray-700 dark:text-gray-200">
                {node.title}
              </span>
            )}
            {typeof node.durationMs === "number" && (
              <span className="text-xs tabular-nums text-gray-400">
                {formatDuration(node.durationMs)}
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-gray-400">
              {open ? "收起" : "展开"}
            </span>
          </button>
        </div>

        {open && (
          <div
            data-thought-detail={node.id}
            className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-sm leading-relaxed text-gray-700 dark:bg-gray-900/50 dark:text-gray-300"
          >
            {node.detail || "（无更多细节）"}
          </div>
        )}

        {node.children.length > 0 && (
          <ul className="mt-3 ml-1 flex flex-col gap-3 border-l border-gray-200 pl-3 dark:border-gray-800">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section
      data-thought-tree
      className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>思维树 · {tree.nodes.length} 节点</span>
        {tree.counts.conflict > 0 && (
          <span
            data-thought-legend-conflict
            className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            博弈 {tree.counts.conflict}
          </span>
        )}
        {tree.linear && (
          <span
            data-thought-linear
            className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800"
          >
            线性树干（无分叉）
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {renderNode(tree.root, 0)}
      </ul>
    </section>
  );
}
