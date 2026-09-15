"use client";

import Link from "next/link";
import { useState } from "react";
import {
  getReport,
  listHistory,
  removeReport,
  type HistoryEntry,
} from "@/lib/history";
import { formatEvidenceStats } from "@/lib/report/evidence-labels";
import {
  createStore,
  useClientSnapshot,
  useIsHydrated,
} from "@/lib/hooks/client-snapshot";
import type { DiffReport } from "@/lib/compare/report-diff";
import { ReportDiffModal, type DiffSide } from "./history/ReportDiffModal";

/**
 * 历史记录列表（Wave 5.6；W2 加证据计数；W21 加对比模式）—— 读取 localStorage 中的本地历史，可回看/删除。
 *
 * 存储读取经 useSyncExternalStore 订阅（而非「挂载时 setState」）：服务端渲染空列表、
 * 客户端挂载后再切到真实值 —— 避免 hydration mismatch 与 react-hooks/set-state-in-effect。
 *
 * W21：对比模式最多勾选 2 份，勾满后底部浮出操作栏；对比以**较早的一份为基准**（base），
 * 这样「改动方向」符合阅读直觉。
 */

/** 一次对比最多勾选的份数 */
export const MAX_COMPARE_SELECTION = 2;

const EMPTY: HistoryEntry[] = [];

const historyStore = createStore<HistoryEntry[]>(
  (() => {
    let cacheKey: string | null | undefined = undefined;
    let cache: HistoryEntry[] = EMPTY;
    return () => {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem("key:history");
      } catch {
        raw = null;
      }
      if (raw !== cacheKey) {
        cacheKey = raw;
        try {
          cache = raw ? listHistory(localStorage) : EMPTY;
        } catch {
          cache = EMPTY;
        }
      }
      return cache;
    };
  })(),
);

export function HistoryList() {
  const hydrated = useIsHydrated();
  const entries = useClientSnapshot(
    historyStore.read,
    EMPTY,
    historyStore.subscribe,
  );
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [diffPair, setDiffPair] = useState<{ base: DiffSide; compare: DiffSide } | null>(
    null,
  );

  function handleRemove(id: string) {
    try {
      removeReport(localStorage, id);
    } catch {
      // 删除失败不阻塞
    }
    setSelected((prev) => prev.filter((x) => x !== id));
    historyStore.notify();
  }

  function toggleCompareMode() {
    setCompareMode((v) => !v);
    setSelected([]);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE_SELECTION) return prev; // 上限：不挤掉已选
      return [...prev, id];
    });
  }

  // 以较早的一份为基准（base）
  const pair = entries
    .filter((e) => selected.includes(e.id))
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  function openDiff() {
    if (pair.length !== MAX_COMPARE_SELECTION) return;
    try {
      setDiffPair({
        base: toSide(pair[0]),
        compare: toSide(pair[1]),
      });
    } catch {
      // 报告体读取失败：不弹窗（列表中仍有原始记录可回看）
    }
  }

  function toSide(entry: HistoryEntry): DiffSide {
    const report = getReport<DiffReport>(localStorage, entry.id);
    return {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      report: report ?? {},
    };
  }

  if (!hydrated) {
    return <p className="text-sm text-gray-400">加载中…</p>;
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        还没有历史记录。去
        <Link href="/" className="mx-1 underline">
          首页
        </Link>
        拆解一个产品试试。
      </p>
    );
  }

  const atLimit = selected.length >= MAX_COMPARE_SELECTION;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-history-compare-toggle
          aria-pressed={compareMode}
          onClick={toggleCompareMode}
          className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${
            compareMode
              ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
              : "border-gray-300 text-gray-600 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
          }`}
        >
          {compareMode ? "退出对比模式" : "对比模式"}
        </button>
        {compareMode && (
          <span data-history-selected-count className="text-xs text-gray-400">
            已选 {selected.length}/{MAX_COMPARE_SELECTION}
            {atLimit ? " · 最多勾选 2 份" : " · 勾选 2 份后可对比"}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        {entries.map((entry) => {
          const checked = selected.includes(entry.id);
          // 审查修复：先算好摘要；全零时为空串 —— 避免渲染出无可见文本的空 span
          const statsText = entry.evidenceStats
            ? formatEvidenceStats(entry.evidenceStats)
            : "";
          return (
            <li
              key={entry.id}
              data-history-row={entry.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex min-w-0 items-center gap-3">
                {compareMode && (
                  <input
                    type="checkbox"
                    data-history-select={entry.id}
                    aria-label={`选择 ${entry.name}`}
                    checked={checked}
                    // 已勾满 2 份时禁用其余项，避免「勾了第 3 个却悄悄挤掉第 1 个」
                    disabled={!checked && atLimit}
                    onChange={() => toggleSelect(entry.id)}
                    className="h-4 w-4 shrink-0 accent-blue-600"
                  />
                )}
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/report/${entry.id}`}
                    className="truncate font-medium hover:underline"
                  >
                    {entry.name}
                  </Link>
                  <span className="text-xs text-gray-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  {statsText ? (
                    <span className="mt-0.5 text-xs text-gray-400">
                      {statsText}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(entry.id)}
                className="shrink-0 text-xs text-gray-400 transition hover:text-red-500"
              >
                删除
              </button>
            </li>
          );
        })}
      </ul>

      {compareMode && pair.length === MAX_COMPARE_SELECTION && (
        <div
          data-history-diff-bar
          className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 p-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95"
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
              基准：{pair[0].name} ↔ 对比：{pair[1].name}
            </span>
            <button
              type="button"
              data-history-diff-action
              onClick={openDiff}
              className="ml-auto shrink-0 rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition dark:bg-white dark:text-black"
            >
              对比这 2 份报告 (Diff)
            </button>
          </div>
        </div>
      )}

      {diffPair && (
        <ReportDiffModal
          base={diffPair.base}
          compare={diffPair.compare}
          onClose={() => setDiffPair(null)}
        />
      )}
    </div>
  );
}
