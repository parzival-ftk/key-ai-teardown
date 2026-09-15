"use client";

import type { Branch } from "@/lib/agents/branch-rerun";

/**
 * 推理分支选择器（W24）。
 *
 * 同一份报告下挂多个平行分支（`main` / `branch-1` / …），
 * 切换分支会同时更新思维树结构与关联的报告 Markdown 内容。
 */

export interface BranchSelectorProps {
  branches: Branch[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function BranchSelector({ branches, activeId, onSelect }: BranchSelectorProps) {
  if (branches.length === 0) return null;

  return (
    <div
      data-branch-selector
      role="tablist"
      aria-label="推理分支切换"
      className="flex flex-wrap gap-2"
    >
      {branches.map((branch) => {
        const active = branch.id === activeId;
        return (
          <button
            key={branch.id}
            type="button"
            role="tab"
            data-branch-option={branch.id}
            aria-selected={active}
            onClick={() => onSelect(branch.id)}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
              active
                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black"
                : "border-gray-300 text-gray-600 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
            }`}
          >
            {branch.label}
            {branch.targetNodeId && (
              <span
                data-branch-target={branch.targetNodeId}
                className="rounded bg-amber-100 px-1 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              >
                干预
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
