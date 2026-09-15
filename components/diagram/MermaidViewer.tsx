"use client";

import { useEffect, useId, useRef, useState } from "react";
import { renderMermaidSvg, type MermaidRenderer } from "@/lib/diagram/render-mermaid";
import type { MermaidDiagramKind } from "@/lib/diagram/mermaid-blocks";
import { buildMermaidElementId } from "@/lib/diagram/mermaid-element-id";
import { XStateExportModal } from "./XStateExportModal";
import { MermaidEditorModal } from "./MermaidEditorModal";

// 实现已抽到 lib/diagram/mermaid-element-id（编辑器实时预览共用，避免唯一性规则两处漂移）；
// 这里 re-export 以保持既有导入路径不变。
export { buildMermaidElementId };

/**
 * Mermaid 图谱查看器（W15）。
 *
 * 关键约束：
 * - **客户端动态 mount**：mermaid 只在浏览器里按需 `import()`（见 render-mermaid），
 *   服务端与首帧一律渲染占位符 —— 避免 SSR 阶段碰 DOM 报错与 hydration 不一致。
 * - **错误降级**：语法非法 / 渲染失败时显示提示 + **原始源码**，不让报告开天窗。
 * - **安全**：源码来自 LLM（不可信），mermaid 以 `securityLevel: "strict"` 渲染且关闭 htmlLabels。
 * - 状态是**派生**的（由 result 与当前 code 比较得出），effect 里不做同步 setState。
 */

const KIND_LABEL: Record<MermaidDiagramKind, string> = {
  flowchart: "流程图",
  state: "状态图",
  other: "图谱",
};

export type MermaidStatus = "rendering" | "ok" | "error";

interface RenderResult {
  code: string;
  svg?: string;
  error?: string;
}

/**
 * 错误降级视图（纯展示，独立导出便于单测）。
 * 非法语法时把原始源码摆出来 —— 用户至少能看到模型写了什么、再决定怎么改。
 */
export function MermaidErrorFallback({
  code,
  error,
}: {
  code: string;
  error: string;
}) {
  return (
    <div
      data-mermaid-error
      className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs dark:border-red-900 dark:bg-red-950"
    >
      <p className="text-red-700 dark:text-red-300">
        图谱渲染失败：{error}（以下为原始源码，可复制后自行修正）
      </p>
      <pre
        data-mermaid-fallback-source
        className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-gray-700 dark:text-gray-300"
      >
        {code}
      </pre>
    </div>
  );
}

export interface MermaidViewerProps {
  /** mermaid 源码（不含围栏） */
  code: string;
  title?: string;
  kind?: MermaidDiagramKind;
  /** 渲染器注入点（测试用）；缺省走 lib/diagram/render-mermaid 的动态 import 实现 */
  renderer?: MermaidRenderer;
  /** 提供时工具栏出现「编辑图谱」（W19）；编辑结果经此回传，由父层写回 PRD */
  onEditCommit?: (newCode: string) => void;
  /** W26：提供时工具栏出现「从截图还原图谱」入口（由父层打开截图识别 Modal） */
  onExtractFromImage?: () => void;
}

export function MermaidViewer({
  code,
  title,
  kind = "flowchart",
  renderer,
  onEditCommit,
  onExtractFromImage,
}: MermaidViewerProps) {
  const [result, setResult] = useState<RenderResult | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  // W18：状态图可导出为 XState 机器（JSON / TypeScript）
  const [xstateOpen, setXstateOpen] = useState(false);
  // W19：图谱交互编辑器（改动同步回 PRD）
  const [editorOpen, setEditorOpen] = useState(false);
  const instanceKey = useId();
  const seq = useRef(0);

  useEffect(() => {
    seq.current += 1;
    const id = buildMermaidElementId(instanceKey, seq.current);
    let cancelled = false;
    void (async () => {
      const outcome = await renderMermaidSvg(code, id, renderer);
      if (!cancelled) setResult({ code, ...outcome });
    })();
    return () => {
      cancelled = true;
    };
  }, [code, instanceKey, renderer]);

  // 派生状态：result 还没回来、或它对应的不是当前 code，就是「渲染中」
  const status: MermaidStatus =
    result === null || result.code !== code
      ? "rendering"
      : result.error
        ? "error"
        : "ok";
  const svg = status === "ok" ? (result?.svg ?? "") : "";

  async function copySource() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用：静默降级
    }
  }

  const toolbarButton =
    "rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition hover:border-gray-400 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300";

  return (
    <section
      data-mermaid-viewer
      data-mermaid-status={status}
      className={
        fullscreen
          ? "fixed inset-0 z-50 overflow-auto bg-white p-6 dark:bg-gray-950"
          : "mt-3 flex flex-col gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
      }
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          {title ?? `${KIND_LABEL[kind]}（Mermaid）`}
        </span>
        <div
          role="toolbar"
          aria-label="图谱工具栏"
          data-mermaid-toolbar
          className="ml-auto flex flex-wrap items-center gap-1"
        >
          <button
            type="button"
            data-mermaid-action="zoom-out"
            aria-label="缩小"
            onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.2) * 100) / 100))}
            className={toolbarButton}
          >
            −
          </button>
          <span
            data-mermaid-zoom
            className="min-w-10 text-center text-xs tabular-nums text-gray-500 dark:text-gray-400"
          >
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            data-mermaid-action="zoom-in"
            aria-label="放大"
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.2) * 100) / 100))}
            className={toolbarButton}
          >
            ＋
          </button>
          <button
            type="button"
            data-mermaid-action="zoom-reset"
            onClick={() => setZoom(1)}
            className={toolbarButton}
          >
            重置
          </button>
          <button
            type="button"
            data-mermaid-action="fullscreen"
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((v) => !v)}
            className={toolbarButton}
          >
            {fullscreen ? "退出全屏" : "全屏"}
          </button>
          <button
            type="button"
            data-mermaid-action="copy"
            onClick={copySource}
            className={toolbarButton}
          >
            {copied ? "已复制" : "复制源码"}
          </button>
          {/* W18：状态图才提供 XState 导出（flowchart 与状态机语义不同构） */}
          {kind === "state" && (
            <button
              type="button"
              data-mermaid-action="export-xstate"
              onClick={() => setXstateOpen(true)}
              className={toolbarButton}
            >
              导出 XState
            </button>
          )}
          {/* W19：编辑图谱（仅当父层提供了同步回调时才出现，避免死按钮） */}
          {onEditCommit && (
            <button
              type="button"
              data-mermaid-action="edit"
              onClick={() => setEditorOpen(true)}
              className={toolbarButton}
            >
              编辑图谱
            </button>
          )}
          {/* W26：从截图还原图谱（父层负责打开识别 Modal 并写回） */}
          {onExtractFromImage && (
            <button
              type="button"
              data-mermaid-action="extract-from-image"
              onClick={onExtractFromImage}
              className={toolbarButton}
            >
              从截图还原图谱 (Extract from Image)
            </button>
          )}
        </div>
      </header>

      <div className="overflow-auto" data-mermaid-canvas>
        {status === "ok" ? (
          <div
            data-mermaid-svg
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
            // mermaid 输出；已以 securityLevel:"strict" 渲染（标签净化、禁用脚本）
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p data-mermaid-placeholder className="text-xs text-gray-400">
            图谱渲染中…
          </p>
        )}
      </div>

      {status === "error" && result && (
        <MermaidErrorFallback code={code} error={result.error ?? "未知错误"} />
      )}

      <details className="text-xs text-gray-500 dark:text-gray-400">
        <summary className="cursor-pointer">查看 Mermaid 源码</summary>
        <pre
          data-mermaid-source
          className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]"
        >
          {code}
        </pre>
      </details>

      {xstateOpen && (
        <XStateExportModal code={code} onClose={() => setXstateOpen(false)} />
      )}

      {editorOpen && (
        <MermaidEditorModal
          code={code}
          kind={kind}
          title={title}
          renderer={renderer}
          onApply={onEditCommit}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </section>
  );
}
