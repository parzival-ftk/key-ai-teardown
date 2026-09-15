"use client";

import { useState } from "react";
import { ReasoningTimeline } from "./ReasoningTimeline";
import { ThoughtTreeView } from "./ThoughtTreeView";
import type { ReasoningStep } from "@/lib/agents/reasoning-parser";
import type { ThoughtTreeResult, ThoughtTreeNode } from "@/lib/agents/thought-tree";

/**
 * 报告页「Agent 推理过程」面板（W23）。
 *
 * 在同一份推理步骤上提供两个视角：
 *   - 线性时间轴（Timeline）：按发生顺序的垂直步骤流（W22）
 *   - 思维图树（Tree View）：按推导/质疑/修正分化的层次结构（W23）
 *
 * 面板只接 props（steps + 回调），不读存储 —— 与 W21/W22 同一条纪律。
 */

export type ReasoningView = "timeline" | "tree";

export interface ReasoningPanelProps {
  steps: ReasoningStep[];
  /** 直接指定思维树（分支视图）；缺省由 steps 构建 */
  tree?: ThoughtTreeResult;
  /** 默认视图（默认时间轴） */
  defaultView?: ReasoningView;
  /** 树节点点击回调（用于高亮报告区块） */
  onSelectNode?: (node: ThoughtTreeNode) => void;
  /** 点「干预」回调（打开人工干预弹窗） */
  onIntervene?: (node: ThoughtTreeNode) => void;
}

const TABS: { key: ReasoningView; label: string }[] = [
  { key: "timeline", label: "线性时间轴 (Timeline)" },
  { key: "tree", label: "思维图树 (Tree View)" },
];

export function ReasoningPanel({
  steps,
  tree,
  defaultView = "timeline",
  onSelectNode,
  onIntervene,
}: ReasoningPanelProps) {
  const [view, setView] = useState<ReasoningView>(defaultView);

  return (
    <div data-reasoning-panel-inner className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="推理过程视图切换"
        className="flex flex-wrap gap-2"
      >
        {TABS.map((tab) => {
          const active = view === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              data-reasoning-tab={tab.key}
              aria-selected={active}
              onClick={() => setView(tab.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black"
                  : "border-gray-300 text-gray-600 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {view === "timeline" ? (
        <ReasoningTimeline steps={steps} />
      ) : (
        <ThoughtTreeView
          steps={steps}
          tree={tree}
          onSelectNode={onSelectNode}
          onIntervene={onIntervene}
        />
      )}
    </div>
  );
}
