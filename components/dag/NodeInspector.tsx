"use client";

import { useEffect } from "react";
import type { DagNodeConfig } from "@/lib/orchestration/dagConfig";
import {
  nodeElapsedMs,
  type DagNodeState,
  type DagNodeStatus,
} from "@/lib/orchestration/dag-state";

const STATUS_LABEL: Record<DagNodeStatus, string> = {
  pending: "待执行",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
};

const STATUS_CLASS: Record<DagNodeStatus, string> = {
  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export interface NodeInspectorProps {
  node: DagNodeConfig;
  state: DagNodeState | undefined;
  /** 用于把依赖 id 翻成展示名 */
  nodesById: Record<string, DagNodeConfig>;
  /** 本次分析的输入（简报） */
  briefName?: string;
  briefDescription?: string;
  now: number;
  onClose: () => void;
}

/**
 * Node Inspector（W13）—— 点节点展开：Prompt 简报 / 输入依赖 / 流式产出。
 * 只读视图；数据全部来自已在本地的 DAG 配置与直播状态，不额外发起请求。
 */
export function NodeInspector({
  node,
  state,
  nodesById,
  briefName,
  briefDescription,
  now,
  onClose,
}: NodeInspectorProps) {
  const status: DagNodeStatus = state?.status ?? "pending";
  const elapsed = state ? nodeElapsedMs(state, now) : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      data-dag-inspector
      aria-label={`${node.name} 详情`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-950"
    >
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold">{node.name}</h2>
          <code className="font-mono text-xs text-gray-400">{node.id}</code>
        </div>
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`}
          data-dag-inspector-status={status}
        >
          {STATUS_LABEL[status]}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 transition hover:border-gray-400 dark:border-gray-800"
        >
          关闭
        </button>
      </header>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-gray-400">
          PROMPT 简报
        </h3>
        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {node.brief}
        </p>
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          本次输入：
          {briefName ? (
            <>
              <span className="text-gray-700 dark:text-gray-200">{briefName}</span>
              {briefDescription ? ` —— ${briefDescription}` : ""}
            </>
          ) : (
            "（未读取到输入简报）"
          )}
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-gray-400">
          输入依赖（{node.dependsOn.length}）
        </h3>
        {node.dependsOn.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            无 —— 并行起始节点
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {node.dependsOn.map((dep) => (
              <li
                key={dep}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                {nodesById[dep]?.name ?? dep}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-gray-400">
          流式产出（{state?.chars ?? 0} 字符
          {elapsed === null ? "" : ` · ${(elapsed / 1000).toFixed(1)}s`}
          {typeof state?.confidence === "number"
            ? ` · 置信度 ${state.confidence}`
            : ""}
          ）
        </h3>
        <pre
          data-dag-output
          className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
        >
          {state?.output
            ? state.output
            : status === "pending"
              ? "（尚未开始）"
              : status === "failed"
                ? "（该 Agent 失败）"
                : "（等待产出…）"}
        </pre>
      </section>
    </aside>
  );
}
