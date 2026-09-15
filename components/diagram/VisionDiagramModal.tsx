"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 截图识别 Modal（W26）—— 把一张架构图截图变成 mermaid 代码。
 *
 * 三条上传通道（同一入口 `ingestFile`）：拖拽、文件选择器、剪贴板粘贴（Ctrl/Cmd+V）。
 * 上传后调用 `/api/parse`（`type: "diagram"`，即 W25 的多模态提取通道），
 * 展示识别元数据与代码，并给出两个出口：
 *   - 「载入编辑器」→ 交给 W19 `MermaidEditorModal` 二次修正；
 *   - 「直接替换章节图谱」→ 由宿主写回该段 PRD 的 mermaid 围栏。
 *
 * 降级安全：`/api/parse` 的 diagram 通道**永不抛错**，识别不出时返回
 * `source: "fallback"` 的安全默认结构。此时两个出口一律禁用 —— 不把占位结构写进 PRD。
 */

/** `/api/parse`(diagram) 的响应体（W25 契约） */
export interface VisionParseResponse {
  ok: boolean;
  code: string;
  diagramType: string;
  confidenceScore: number;
  detectedNodesCount: number;
  /** model | stub | fallback */
  source: string;
  error?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  model: "模型识别",
  stub: "本地 Stub",
  fallback: "安全降级",
};

export interface VisionDiagramModalProps {
  /** 由宿主控制显隐（与其它 Modal 一致，组件内部不持有 open） */
  open?: boolean;
  /** 上下文标题，例如「PRD 撰写官 · 流程图」 */
  title?: string;
  /** 传给 /api/parse 的图形类型提示（flowchart / state） */
  diagramTypeHint?: string;
  onClose: () => void;
  /** 「直接替换章节图谱」：把识别出的代码写回目标围栏 */
  onReplace?: (code: string, result: VisionParseResponse) => void;
  /** 「载入编辑器」：交给 W19 编辑器二次修正 */
  onOpenInEditor?: (code: string) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function VisionDiagramModal({
  open = true,
  title,
  diagramTypeHint,
  onClose,
  onReplace,
  onOpenInEditor,
}: VisionDiagramModalProps) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<VisionParseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const recognize = useCallback(
    async (dataUrl: string) => {
      setStatus("loading");
      setError(null);
      setResult(null);
      try {
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "diagram",
            dataUrl,
            diagramTypeHint,
          }),
        });
        if (!res.ok) throw new Error(`识别服务返回 HTTP ${res.status}`);
        const data = (await res.json()) as VisionParseResponse;
        setResult(data);
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "识别失败，请重试");
        setStatus("error");
      }
    },
    [diagramTypeHint],
  );

  const ingestFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setImageDataUrl(null);
        setResult(null);
        setError("仅支持图片文件（png / jpeg / webp / gif）");
        setStatus("error");
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setImageDataUrl(dataUrl);
        await recognize(dataUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "图片读取失败");
        setStatus("error");
      }
    },
    [recognize],
  );

  // 剪贴板粘贴：仅在本 Modal 打开期间监听 window
  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            void ingestFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, ingestFile]);

  if (!open) return null;

  const degraded = result?.source === "fallback";
  const canUse = status === "done" && !degraded && Boolean(result?.code?.trim());

  const actionButton =
    "rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:border-gray-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200";

  return (
    <div
      data-vision-modal
      role="dialog"
      aria-modal="true"
      aria-label="从截图还原图谱"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-sm font-semibold">从截图还原图谱</h2>
            {title && <span className="truncate text-xs text-gray-400">{title}</span>}
          </div>
          <button
            type="button"
            data-vision-action="close"
            onClick={onClose}
            aria-label="关闭"
            className="rounded px-2 py-0.5 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
          <div
            data-vision-dropzone
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void ingestFile(event.dataTransfer?.files?.[0]);
            }}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
              dragActive
                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40"
                : "border-gray-300 dark:border-gray-700"
            }`}
          >
            <p className="text-sm text-gray-600 dark:text-gray-300">
              把架构图截图拖到这里，或
              <button
                type="button"
                data-vision-action="pick"
                onClick={() => inputRef.current?.click()}
                className="mx-1 underline"
              >
                选择图片
              </button>
              ，也可以直接 Ctrl+V 粘贴
            </p>
            <p className="text-[11px] text-gray-400">
              支持 png / jpeg / webp / gif
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              data-vision-file-input
              onChange={(event) => void ingestFile(event.target.files?.[0])}
              className="hidden"
            />
            {imageDataUrl && (
              // 本地预览：图片来自用户本机，非远端资源
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-vision-preview
                src={imageDataUrl}
                alt="待识别的架构图"
                className="mt-1 max-h-40 rounded-lg border border-gray-200 dark:border-gray-700"
              />
            )}
          </div>

          {status === "loading" && (
            <p
              data-vision-spinner
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"
            >
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"
              />
              正在识别截图…
            </p>
          )}

          {status === "error" && error && (
            <p
              data-vision-error
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              识别失败：{error}
            </p>
          )}

          {status === "done" && result && (
            <div className="flex flex-col gap-2">
              <p
                data-vision-meta
                className="text-sm text-gray-700 dark:text-gray-200"
              >
                检测到 {result.detectedNodesCount} 个节点，置信度{" "}
                {result.confidenceScore}%
                <span
                  data-vision-source={result.source}
                  className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  {SOURCE_LABEL[result.source] ?? result.source} · {result.diagramType}
                </span>
              </p>

              {degraded && (
                <p
                  data-vision-degraded
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                >
                  已安全降级：{result.error ?? "未能从这张截图识别出结构"}
                  。请换一张更清晰的架构图重试 —— 不会把占位结构写入 PRD。
                </p>
              )}

              <pre
                data-vision-code
                className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200"
              >
                {result.code}
              </pre>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <button
            type="button"
            data-vision-action="close"
            onClick={onClose}
            className={actionButton}
          >
            取消
          </button>
          <button
            type="button"
            data-vision-action="editor"
            onClick={() => result && onOpenInEditor?.(result.code)}
            disabled={!canUse || !onOpenInEditor}
            className={`ml-auto ${actionButton}`}
          >
            载入编辑器 (Open in Editor)
          </button>
          <button
            type="button"
            data-vision-action="replace"
            onClick={() => result && onReplace?.(result.code, result)}
            disabled={!canUse || !onReplace}
            className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-40 dark:bg-white dark:text-black"
          >
            直接替换章节图谱 (Replace Section Diagram)
          </button>
        </footer>
      </div>
    </div>
  );
}
