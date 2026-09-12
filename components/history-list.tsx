"use client";

import Link from "next/link";
import { listHistory, removeReport, type HistoryEntry } from "@/lib/history";
import { formatEvidenceStats } from "@/lib/report/evidence-labels";
import {
  createStore,
  useClientSnapshot,
  useIsHydrated,
} from "@/lib/hooks/client-snapshot";

/**
 * 历史记录列表（Wave 5.6；W2 加证据计数）—— 读取 localStorage 中的本地历史，可回看/删除。
 *
 * 存储读取经 useSyncExternalStore 订阅（而非「挂载时 setState」）：服务端渲染空列表、
 * 客户端挂载后再切到真实值 —— 避免 hydration mismatch 与 react-hooks/set-state-in-effect。
 */
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

  function handleRemove(id: string) {
    try {
      removeReport(localStorage, id);
    } catch {
      // 删除失败不阻塞
    }
    historyStore.notify();
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

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => {
        // 审查修复：先算好摘要；全零时为空串 —— 避免渲染出无可见文本的空 span
        const statsText = entry.evidenceStats
          ? formatEvidenceStats(entry.evidenceStats)
          : "";
        return (
          <li
            key={entry.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
          >
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
  );
}
