"use client";

import { useState } from "react";

/**
 * Figma JSON 导出弹窗（W17）。
 *
 * 展示转换引擎产出的 Figma Node JSON，提供「一键复制」与「.json 下载」。
 * 纯展示组件：json 由调用方（界面代码预览）经 `/api/export` 取回后传入；
 * 下载实现可注入（默认 Blob 下载）——便于在 jsdom 下断言交互而不触碰真实下载。
 */

/** 下载实现签名（可注入以便测试） */
export type FigmaJsonDownloader = (filename: string, text: string) => void;

/** 默认下载：构造 Blob + 触发浏览器下载 */
export function downloadFigmaJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface FigmaExportModalProps {
  /** 待展示 / 复制 / 下载的 JSON 文本 */
  json: string;
  onClose: () => void;
  /** 下载文件名（默认 figma-export.json） */
  filename?: string;
  /** 可注入的下载实现（默认 downloadFigmaJson） */
  downloader?: FigmaJsonDownloader;
}

export function FigmaExportModal({
  json,
  onClose,
  filename = "figma-export.json",
  downloader = downloadFigmaJson,
}: FigmaExportModalProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用（非 https / 无权限）：静默降级，用户仍可手动选中复制
    }
  }

  return (
    <div
      data-figma-modal
      role="dialog"
      aria-modal="true"
      aria-label="导出 Figma JSON"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      {/* 阻止冒泡：点击面板内部不关闭 */}
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          <h2 className="text-sm font-semibold">导出 Figma JSON</h2>
          <button
            type="button"
            data-figma-action="close"
            onClick={onClose}
            aria-label="关闭"
            className="rounded px-2 py-0.5 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        <p className="px-4 pt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          可在 Figma Plugin（如 JSON to Figma）或轻量原型工具中导入此 JSON 生成设计图层。
        </p>

        <pre
          data-figma-json
          className="mx-4 my-3 max-h-96 flex-1 overflow-auto rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-800 dark:bg-black dark:text-gray-200"
        >
          <code>{json}</code>
        </pre>

        <div className="flex gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <button
            type="button"
            data-figma-action="copy"
            onClick={copy}
            className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition dark:bg-white dark:text-black"
          >
            {copied ? "已复制" : "一键复制 JSON"}
          </button>
          <button
            type="button"
            data-figma-action="download"
            onClick={() => downloader(filename, json)}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:border-gray-500 dark:border-gray-700 dark:text-gray-200"
          >
            下载 .json 文件
          </button>
        </div>
      </div>
    </div>
  );
}
