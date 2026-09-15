"use client";

import { useMemo, useState } from "react";
import { exportXState } from "@/lib/export/xstate-exporter";
import { tokenize, type TokenType } from "@/lib/export/code-highlight";

/**
 * XState 导出弹窗（W18）。
 *
 * 与 W17 的 Figma 弹窗不同，这里**在客户端直接跑转换引擎**：引擎是零依赖纯函数
 * （不碰 DOM / 网络 / cheerio），因此无需 API 往返，预览即时、离线可用；
 * `/api/export` 的 `format=xstate` 提供同一引擎的服务端出口（见 app/api/export）。
 *
 * 弹窗提供 JSON / TypeScript 双格式切换、语法高亮预览、「一键复制」与「.ts/.json 下载」。
 */

/** 下载实现签名（可注入以便测试） */
export type CodeDownloader = (filename: string, text: string) => void;

/** 默认下载：Blob + 触发浏览器下载 */
export function downloadCodeFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Language = "json" | "ts";

const TAB_LABEL: Record<Language, string> = {
  json: "JSON",
  ts: "TypeScript",
};

const TOKEN_CLASS: Record<TokenType, string> = {
  comment: "text-gray-400 italic",
  string: "text-emerald-700 dark:text-emerald-400",
  property: "text-sky-700 dark:text-sky-300",
  number: "text-amber-700 dark:text-amber-400",
  boolean: "text-purple-700 dark:text-purple-400",
  keyword: "text-pink-700 dark:text-pink-400",
  punctuation: "text-gray-500 dark:text-gray-400",
  plain: "",
};

/** 语法高亮预览（token → span，不做 HTML 注入） */
export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: Language;
}) {
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  return (
    <code data-xstate-code data-xstate-language={language}>
      {tokens.map((token, i) =>
        token.type === "plain" ? (
          <span key={i}>{token.value}</span>
        ) : (
          <span key={i} data-token={token.type} className={TOKEN_CLASS[token.type]}>
            {token.value}
          </span>
        ),
      )}
    </code>
  );
}

export interface XStateExportModalProps {
  /** Mermaid stateDiagram-v2 源码（不含围栏） */
  code: string;
  onClose: () => void;
  /** 机器 id（缺省 machine） */
  machineId?: string;
  /** 下载文件名基（缺省 machine → machine.json / machine.ts） */
  baseName?: string;
  /** 可注入的下载实现（默认 downloadCodeFile） */
  downloader?: CodeDownloader;
}

export function XStateExportModal({
  code,
  onClose,
  machineId,
  baseName = "machine",
  downloader = downloadCodeFile,
}: XStateExportModalProps) {
  const [tab, setTab] = useState<Language>("json");
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () => exportXState(code, { id: machineId, exportName: baseName }),
    [code, machineId, baseName],
  );

  const text = tab === "json" ? result.json : result.ts;
  const filename = `${baseName}.${tab}`;
  const stateCount = Object.keys(result.config.states).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用（非 https / 无权限）：静默降级，用户仍可手动选中
    }
  }

  const tabClass = (active: boolean) =>
    `rounded px-3 py-1 text-xs font-medium transition ${
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;

  return (
    <div
      data-xstate-modal
      role="dialog"
      aria-modal="true"
      aria-label="导出 XState"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">导出 XState</h2>
            <div className="flex items-center gap-1" role="tablist">
              {(["json", "ts"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  role="tab"
                  aria-selected={tab === lang}
                  data-xstate-tab={lang}
                  onClick={() => setTab(lang)}
                  className={tabClass(tab === lang)}
                >
                  {TAB_LABEL[lang]}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            data-xstate-action="close"
            onClick={onClose}
            aria-label="关闭"
            className="rounded px-2 py-0.5 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        <p className="px-4 pt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          由 PRD 状态图（Mermaid stateDiagram-v2）转换为 XState v5 机器配置，共 {stateCount} 个状态。
          TypeScript 可直接落地；JSON 可喂给 Stately Studio / 其它工具。
        </p>

        {result.diagnostics.length > 0 && (
          <ul
            data-xstate-diagnostics
            className="mx-4 mt-2 list-disc rounded-lg bg-amber-50 py-2 pl-8 pr-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            {result.diagnostics.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}

        <pre
          data-xstate-preview
          className="mx-4 my-3 max-h-96 flex-1 overflow-auto rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-800 dark:bg-black dark:text-gray-200"
        >
          <HighlightedCode code={text} language={tab} />
        </pre>

        <div className="flex gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <button
            type="button"
            data-xstate-action="copy"
            onClick={copy}
            className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition dark:bg-white dark:text-black"
          >
            {copied ? "已复制" : "一键复制"}
          </button>
          <button
            type="button"
            data-xstate-action="download"
            onClick={() => downloader(filename, text)}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:border-gray-500 dark:border-gray-700 dark:text-gray-200"
          >
            下载 {filename}
          </button>
        </div>
      </div>
    </div>
  );
}
