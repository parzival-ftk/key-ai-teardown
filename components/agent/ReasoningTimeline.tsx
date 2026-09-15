"use client";

import { useMemo, useState } from "react";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import {
  formatDuration,
  summarizeReasoning,
  UNLABELED_AGENT_ID,
  type ReasoningStep,
  type ReasoningStepKind,
} from "@/lib/agents/reasoning-parser";

/**
 * Agent 思考时间轴（W22）。
 *
 * 把 `parseReasoningTrace` 产出的结构化步骤渲染成**垂直时间轴**：
 *   - 每个步骤一个节点（Agent 状态圆点 + 展示名 + 步骤类型 + 耗时）
 *   - 思考细节折叠面板（关键断言常显，正文可折叠）
 *   - Action 提示（动作名常显）
 *   - 顶部工具条：「展开/收起全部细节」+「按 Agent 筛选」+「耗时统计」
 *
 * 组件只接 props（steps），不自己读存储 —— 报告体由 report-view 读出后传入，
 * 与 W21 的 Diff 弹窗同一条纪律（组件纯粹、易测）。
 */

const KIND_LABEL: Record<ReasoningStepKind, string> = {
  thought: "思考",
  action: "行动",
  observation: "观察",
  text: "文本",
};

const KIND_DOT: Record<ReasoningStepKind, string> = {
  thought: "bg-violet-500",
  action: "bg-blue-500",
  observation: "bg-green-500",
  text: "bg-gray-400",
};

/** agent id → 展示名（复用报告章节的 owner，避免与 sections.ts 漂移） */
const AGENT_DISPLAY: Record<string, string> = Object.fromEntries(
  REPORT_SECTIONS.map((s) => [s.agentId, s.owner]),
);

export interface ReasoningTimelineProps {
  steps: ReasoningStep[];
  /** 默认是否展开全部细节（默认 true） */
  defaultExpanded?: boolean;
  /** 初始 Agent 筛选；null = 全部 */
  defaultAgentFilter?: string | null;
  /** agent id → 展示名覆盖（可选） */
  agentLabels?: Record<string, string>;
}

export function ReasoningTimeline({
  steps,
  defaultExpanded = true,
  defaultAgentFilter = null,
  agentLabels,
}: ReasoningTimelineProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => new Set(defaultExpanded ? [] : steps.map((s) => s.index)),
  );
  const [agentFilter, setAgentFilter] = useState<string | null>(defaultAgentFilter);

  const summary = useMemo(() => summarizeReasoning(steps), [steps]);
  const rendered = useMemo(
    () =>
      agentFilter
        ? steps.filter((s) => (s.agentId ?? UNLABELED_AGENT_ID) === agentFilter)
        : steps,
    [steps, agentFilter],
  );

  const totalDuration = rendered.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const allCollapsed =
    rendered.length > 0 && rendered.every((s) => collapsed.has(s.index));

  function displayName(id: string | undefined, label?: string): string {
    if (!id) return agentLabels?.[UNLABELED_AGENT_ID] ?? "未标注";
    return agentLabels?.[id] ?? AGENT_DISPLAY[id] ?? label ?? id;
  }

  function toggleStep(index: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed((prev) => {
      const shown = rendered.map((s) => s.index);
      const collapsedAll = shown.length > 0 && shown.every((i) => prev.has(i));
      const next = new Set(prev);
      for (const i of shown) {
        if (collapsedAll) next.delete(i);
        else next.add(i);
      }
      return next;
    });
  }

  if (steps.length === 0) {
    return (
      <section
        data-reasoning-timeline
        className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
      >
        <p data-reasoning-empty className="text-sm text-gray-400">
          暂无推理记录。
        </p>
      </section>
    );
  }

  return (
    <section
      data-reasoning-timeline
      className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-reasoning-expand-all
          onClick={toggleAll}
          className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
        >
          {allCollapsed ? "展开全部细节" : "收起全部细节"}
        </button>
        <span
          data-reasoning-total-duration
          className="text-xs tabular-nums text-gray-500 dark:text-gray-400"
        >
          耗时统计：{formatDuration(totalDuration)} · {rendered.length} 步
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          data-reasoning-filter="all"
          aria-pressed={agentFilter === null}
          onClick={() => setAgentFilter(null)}
          className={chipClass(agentFilter === null)}
        >
          全部 {steps.length}
        </button>
        {summary.map((entry) => {
          const active = agentFilter === entry.agentId;
          return (
            <button
              key={entry.agentId}
              type="button"
              data-reasoning-filter={entry.agentId}
              aria-pressed={active}
              onClick={() => setAgentFilter(entry.agentId)}
              className={chipClass(active)}
            >
              {displayName(
                entry.agentId === UNLABELED_AGENT_ID ? undefined : entry.agentId,
                entry.label,
              )}{" "}
              · {entry.stepCount}
              {entry.hasDuration ? ` · ${formatDuration(entry.totalDurationMs)}` : ""}
            </button>
          );
        })}
      </div>

      <ol className="mt-4 flex flex-col gap-4 border-l border-gray-200 pl-4 dark:border-gray-800">
        {rendered.map((step) => {
          const isCollapsed = collapsed.has(step.index);
          return (
            <li
              key={step.index}
              data-reasoning-step={step.index}
              data-reasoning-kind={step.kind}
              data-reasoning-agent={step.agentId ?? UNLABELED_AGENT_ID}
              className="relative"
            >
              <span
                aria-hidden
                className={`absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full ${KIND_DOT[step.kind]}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  {displayName(step.agentId, step.agentLabel)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {KIND_LABEL[step.kind]}
                </span>
                {typeof step.durationMs === "number" && (
                  <span
                    data-reasoning-node-duration
                    className="text-xs tabular-nums text-gray-400"
                  >
                    {formatDuration(step.durationMs)}
                  </span>
                )}
                <button
                  type="button"
                  data-reasoning-toggle
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleStep(step.index)}
                  className="ml-auto text-xs text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {isCollapsed ? "展开" : "收起"}
                </button>
              </div>

              {step.action && (
                <p data-reasoning-action className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  动作：
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    {step.action}
                  </code>
                </p>
              )}

              {step.assertion && (
                <p
                  data-reasoning-assertion
                  className="mt-1 text-xs text-violet-700 dark:text-violet-300"
                >
                  关键断言：{step.assertion}
                </p>
              )}

              {!isCollapsed && (
                <div
                  data-reasoning-detail
                  className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300"
                >
                  {step.content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function chipClass(active: boolean): string {
  return `rounded-full border px-2.5 py-0.5 text-xs transition ${
    active
      ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black"
      : "border-gray-300 text-gray-600 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
  }`;
}
