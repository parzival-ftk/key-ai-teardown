"use client";

import { useMemo, useState } from "react";
import { diffReports, type DiffReport } from "@/lib/compare/report-diff";
import { HistoryDiffView, type DiffViewMode } from "./HistoryDiffView";

/**
 * 报告差异对比弹窗（W21）。
 *
 * 数据由调用方（历史列表）从 localStorage 读出后传入 —— 组件自身不碰存储，
 * 便于在 jsdom 里直接渲染断言。
 */

export interface DiffSide {
  id: string;
  name: string;
  createdAt?: number;
  report: DiffReport;
}

export interface ReportDiffModalProps {
  base: DiffSide;
  compare: DiffSide;
  onClose: () => void;
}

const MODE_LABEL: Record<DiffViewMode, string> = {
  split: "双栏",
  unified: "单栏",
};

export function ReportDiffModal({ base, compare, onClose }: ReportDiffModalProps) {
  const [mode, setMode] = useState<DiffViewMode>("split");
  const [showUnchanged, setShowUnchanged] = useState(true);

  const diff = useMemo(
    () => diffReports(base.report, compare.report),
    [base.report, compare.report],
  );

  const modeButton = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition ${
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;

  return (
    <div
      data-report-diff-modal
      role="dialog"
      aria-modal="true"
      aria-label="报告差异对比"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          <h2 className="text-sm font-semibold">报告差异对比</h2>
          <span data-diff-pair className="text-xs text-gray-500 dark:text-gray-400">
            {base.name}（基准） → {compare.name}（对比）
          </span>
          <span
            data-diff-summary
            className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            {diff.hasChanges
              ? `新增 ${diff.summary.added} · 删除 ${diff.summary.removed} · 修改 ${diff.summary.modified} · 未变 ${diff.summary.unchanged}`
              : "两份报告完全一致"}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <div role="tablist" className="flex items-center gap-1" data-diff-mode-switch>
              {(["split", "unified"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  data-diff-mode={m}
                  onClick={() => setMode(m)}
                  className={modeButton(mode === m)}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <input
                type="checkbox"
                data-diff-show-unchanged
                checked={showUnchanged}
                onChange={(e) => setShowUnchanged(e.target.checked)}
              />
              显示未变更
            </label>
            <button
              type="button"
              data-diff-action="close"
              onClick={onClose}
              aria-label="关闭"
              className="rounded px-2 py-0.5 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <HistoryDiffView diff={diff} mode={mode} showUnchanged={showUnchanged} />
        </div>
      </div>
    </div>
  );
}
