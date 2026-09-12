"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listHistory, removeReport, type HistoryEntry } from "@/lib/history";
import { formatEvidenceStats } from "@/lib/report/evidence-labels";

/** 历史记录列表（Wave 5.6；W2 加证据计数）—— 读取 localStorage 中的本地历史，可回看/删除。 */
export function HistoryList() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setEntries(listHistory(localStorage));
    } catch {
      setEntries([]);
    }
    setLoaded(true);
  }, []);

  function handleRemove(id: string) {
    try {
      setEntries(removeReport(localStorage, id));
    } catch {
      // 删除失败不阻塞
    }
  }

  if (!loaded) {
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
