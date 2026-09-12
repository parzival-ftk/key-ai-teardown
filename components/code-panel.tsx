"use client";

import { useState } from "react";
import type { CodeBlock } from "@/lib/report/code-blocks";

/**
 * 代码面板（W6）—— 把「界面代码」Agent 产出里的代码围栏渲染成可复制的面板。
 *
 * 只读展示 + 一键复制；刻意不做在线编辑/预览（那是 W7 的范围）。
 * 复制用 navigator.clipboard，不可用时（非 https / 无权限）静默降级——
 * 用户仍可手动选中代码。
 */
export function CodePanel({ blocks }: { blocks: CodeBlock[] }) {
  const [copied, setCopied] = useState<number | null>(null);

  if (blocks.length === 0) return null;

  async function copy(index: number, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(index);
      window.setTimeout(() => {
        setCopied((c) => (c === index ? null : c));
      }, 2000);
    } catch {
      // 剪贴板不可用：静默失败，代码仍可手动选中
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {blocks.map((b, i) => (
        <div
          key={`${b.lang}-${i}`}
          className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
            <span className="font-mono">{b.lang || "code"}</span>
            <button
              type="button"
              onClick={() => copy(i, b.code)}
              className="rounded px-2 py-0.5 transition hover:bg-gray-200 dark:hover:bg-gray-800"
            >
              {copied === i ? "已复制" : "复制"}
            </button>
          </div>
          <pre className="max-h-96 overflow-auto bg-white p-3 text-xs leading-relaxed dark:bg-black">
            <code>{b.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
