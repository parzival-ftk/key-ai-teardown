"use client";

import { useEffect, useRef, useState } from "react";
import { buildPreviewDoc } from "@/lib/report/preview-doc";
import {
  makeCachedValue,
  useClientSnapshot,
} from "@/lib/hooks/client-snapshot";
import { FigmaExportModal } from "./code-canvas/FigmaExportModal";

/** 选中高亮色（导出时会连同选中属性一起剥掉，避免污染代码） */
const SELECT_OUTLINE = "2px solid #2563eb";
const SELECT_ATTR = "data-key-selected";

/**
 * 界面代码预览 / 轻量画布（W7）。
 *
 * 可行性已由 CDP 探针在真实浏览器验证：
 *  - sandbox="allow-same-origin" 时父页面可访问 contentDocument 并做元素选中；
 *  - 注入父页面样式表后，Tailwind 类在 iframe 内确实生效（display/padding/background 均算得）。
 * 因此容器用 allow-same-origin（而非最严格的 ""），**前置条件是 srcdoc 已剥掉脚本**
 * （见 stripScripts）——否则 LLM 产出的脚本可触达父页面。
 *
 * 交互：点击元素 → 选中（描边 + 面板），可改 class 即时反映，可复制改后的 HTML。
 * 已知限制：项目 Tailwind 是按需子集，运行时**新造**的类名不会生效（骨架里出现过的类才有效）。
 */
/**
 * 读取页面上第一个样式表链接（仅客户端存在的 DOM 事实），只求值一次并缓存引用。
 * 经 useClientSnapshot 读取：服务端用 "" 渲染、客户端挂载后切到真实值 —— 既避免
 * hydration mismatch，也避免在 effect 里同步 setState（react-hooks/set-state-in-effect）。
 */
const readStylesheetHref = makeCachedValue(() =>
  typeof document === "undefined"
    ? ""
    : (document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.href ??
      ""),
);

export function CodePreview({ html }: { html: string }) {
  const cssHref = useClientSnapshot(readStylesheetHref, "");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [classDraft, setClassDraft] = useState("");
  const [copied, setCopied] = useState(false);
  // W17：Figma JSON 导出（弹窗展示 / 复制 / 下载）
  const [figmaJson, setFigmaJson] = useState<string | null>(null);
  const [figmaBusy, setFigmaBusy] = useState(false);
  const [figmaError, setFigmaError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener("click", (e) => {
        e.preventDefault();
        const target = e.target as HTMLElement | null;
        if (!target || target === doc.documentElement || target === doc.body) {
          return;
        }
        doc.querySelectorAll(`[${SELECT_ATTR}]`).forEach((el) => {
          const h = el as HTMLElement;
          h.style.outline = "";
          h.removeAttribute(SELECT_ATTR);
        });
        target.style.outline = SELECT_OUTLINE;
        target.setAttribute(SELECT_ATTR, "1");
        const cls = target.getAttribute("class") ?? "";
        setSelectedTag(target.tagName.toLowerCase());
        setClassDraft(cls);
      });
    };

    frame.addEventListener("load", onLoad);
    if (frame.contentDocument) onLoad();
    return () => frame.removeEventListener("load", onLoad);
  }, []);

  if (!html.trim()) return null;

  /**
   * W17：请求服务端把当前 HTML+Tailwind 转成 Figma Node JSON。
   * 转换引擎走 `/api/export`（cheerio 在 server 跑，避免打进 client bundle），
   * 拿到 JSON 文本后交给弹窗展示；失败时给出可读错误而非静默。
   */
  async function exportFigma() {
    if (!html.trim()) return;
    setFigmaBusy(true);
    setFigmaError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "figma", html }),
      });
      if (!res.ok) throw new Error(`导出失败：HTTP ${res.status}`);
      setFigmaJson(await res.text());
    } catch (err) {
      setFigmaError(err instanceof Error ? err.message : "导出失败，请重试");
    } finally {
      setFigmaBusy(false);
    }
  }

  function applyClass() {
    const doc = iframeRef.current?.contentDocument;
    const el = doc?.querySelector(`[${SELECT_ATTR}]`);
    if (!el) return;
    el.setAttribute("class", classDraft);
  }

  async function copyEdited() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const clone = doc.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`[${SELECT_ATTR}]`).forEach((el) => {
      const h = el as HTMLElement;
      h.removeAttribute(SELECT_ATTR);
      h.style.outline = "";
    });
    try {
      await navigator.clipboard.writeText(clone.innerHTML.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用：静默降级
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
        <span>预览（点击元素可选中并改 class）</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportFigma}
            disabled={figmaBusy}
            className="rounded px-2 py-0.5 transition hover:bg-gray-200 disabled:opacity-40 dark:hover:bg-gray-800"
          >
            {figmaBusy ? "导出中…" : "导出 Figma JSON"}
          </button>
          <button
            type="button"
            onClick={copyEdited}
            className="rounded px-2 py-0.5 transition hover:bg-gray-200 dark:hover:bg-gray-800"
          >
            {copied ? "已复制" : "复制当前 HTML"}
          </button>
        </div>
      </div>

      {figmaError && (
        <p className="mb-1 text-xs text-red-600 dark:text-red-400">{figmaError}</p>
      )}

      <iframe
        ref={iframeRef}
        title="界面代码预览"
        className="h-80 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-800"
        sandbox="allow-same-origin"
        srcDoc={buildPreviewDoc(html, cssHref)}
      />

      {selectedTag && (
        <div className="mt-2 flex flex-col gap-1 rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-800">
          <div className="text-gray-400">已选中 &lt;{selectedTag}&gt;</div>
          <div className="flex gap-2">
            <input
              value={classDraft}
              onChange={(e) => setClassDraft(e.target.value)}
              aria-label="编辑 class"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 font-mono dark:border-gray-700 dark:bg-gray-900"
            />
            <button
              type="button"
              onClick={applyClass}
              className="shrink-0 rounded bg-gray-900 px-3 py-1 text-white dark:bg-white dark:text-black"
            >
              应用 class
            </button>
          </div>
        </div>
      )}

      {figmaJson && (
        <FigmaExportModal json={figmaJson} onClose={() => setFigmaJson(null)} />
      )}
    </div>
  );
}
