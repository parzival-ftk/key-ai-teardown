"use client";

import { useState } from "react";
import { buildResourceExtractionPrompt } from "@/lib/resources/resource-prompt";

/**
 * 「如何扩充资源库」面板（W28）—— Master Prompt 在工程体系里的**挂载点**。
 *
 * 让扩充流程在产品里可见、可复制：把新网址粘给助手 → 按契约产出 JSON →
 * 经 `parseResourceItem` 校验、`appendResourceItem` 追加、`serializeResourceDataset`
 * 序列化后贴回 `lib/resources/ui-resources.json`（运行时无法写仓库文件，这一步是手动的）。
 */

export interface ResourceExtendPanelProps {
  /** 已收录的资源 id，拼进 prompt 避免重复扩充 */
  existingIds: string[];
  /** 已收录的标签词汇，拼进 prompt 要求模型优先复用 */
  existingTags?: string[];
}

export function ResourceExtendPanel({
  existingIds,
  existingTags = [],
}: ResourceExtendPanelProps) {
  const [copied, setCopied] = useState(false);
  const prompt = buildResourceExtractionPrompt({
    sources: "",
    existingIds,
    existingTags,
  });

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用：静默降级（prompt 文本仍可见、可手动选中复制）
    }
  }

  return (
    <details
      data-resource-extend
      className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
    >
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">
        如何扩充资源库（附可复制的 Master Prompt）
      </summary>

      <ol className="mt-3 flex list-inside list-decimal flex-col gap-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        <li>复制下面的 Master Prompt，把你发现的新网址粘在末尾，交给助手。</li>
        <li>
          助手按契约产出 JSON 条目（4 个标签、20 字内简介、小写连字符 id）。
        </li>
        <li>
          条目会经 <code>parseResourceItem</code> 校验后追加，再序列化贴回{" "}
          <code>lib/resources/ui-resources.json</code>。
        </li>
        <li>跑 <code>npm run test</code> —— 防漂移用例会拦住格式不对的条目。</li>
      </ol>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-resource-copy-prompt
          onClick={copyPrompt}
          className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-500 dark:border-gray-700 dark:text-gray-200"
        >
          {copied ? "已复制" : "复制 Master Prompt"}
        </button>
        <span className="text-xs text-gray-400">
          已带上 {existingIds.length} 个已收录 id，避免重复
        </span>
      </div>

      <pre
        data-resource-prompt
        className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600 dark:bg-gray-900 dark:text-gray-300"
      >
        {prompt}
      </pre>
    </details>
  );
}
