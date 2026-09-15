"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  diagnoseMermaid,
  hasBlockingDiagnostic,
} from "@/lib/diagram/diagram-lint";
import { appendNode, appendState, formatDiagram } from "@/lib/diagram/diagram-ops";
import { sanitizeMermaidSyntax } from "@/lib/diagram/syntax-sanitizer";
import { optimizeDiagramLayout } from "@/lib/diagram/layout-optimizer";
import { buildMermaidElementId } from "@/lib/diagram/mermaid-element-id";
import {
  renderMermaidSvg,
  type MermaidRenderer,
} from "@/lib/diagram/render-mermaid";
import type { MermaidDiagramKind } from "@/lib/diagram/mermaid-blocks";

/**
 * Mermaid 图谱交互编辑器（W19）。
 *
 * 左：源码编辑区（实时启发式诊断）／右：实时预览。底部两个动作：
 * - 「应用修改并同步至 PRD」→ `onApply(newCode)`，由父层写回该段 PRD 文本；
 * - 「还原为 AI 初始图谱」→ 编辑区与 PRD 一起回到 `code`（撤销编辑）。
 *
 * 为什么自带预览而不复用 `MermaidViewer`：查看器要引入本组件，本组件若反过来 import 查看器
 * 会形成循环依赖。两者共用的只是「渲染元素 id 必须跨实例唯一」这条易错规则
 * （`lib/diagram/mermaid-element-id`），渲染编排各自持有。
 *
 * 校验策略：启发式诊断（同步、立即反馈）+ mermaid 渲染结果（权威）。有阻断性诊断时
 * 禁止「应用」，避免把必然渲染失败的源码写进 PRD 与导出物。
 */

interface PreviewResult {
  code: string;
  svg?: string;
  error?: string;
}

/** 编辑区内的实时预览 */
function EditorPreview({
  code,
  renderer,
}: {
  code: string;
  renderer?: MermaidRenderer;
}) {
  const instanceKey = useId();
  const seq = useRef(0);
  const [result, setResult] = useState<PreviewResult | null>(null);

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

  const status =
    result === null || result.code !== code
      ? "rendering"
      : result.error
        ? "error"
        : "ok";

  if (status === "rendering") {
    return (
      <p data-editor-preview-status="rendering" className="text-xs text-gray-400">
        预览渲染中…
      </p>
    );
  }
  if (status === "error") {
    return (
      <p
        data-editor-preview-status="error"
        className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        图谱不合法：{result?.error ?? "未知错误"}
      </p>
    );
  }
  return (
    <div
      data-editor-preview-status="ok"
      // mermaid 输出；以 securityLevel:"strict" 渲染（标签净化、禁用脚本）
      dangerouslySetInnerHTML={{ __html: result?.svg ?? "" }}
    />
  );
}

export interface MermaidEditorModalProps {
  /** AI 初始图谱源码（「还原」的基准） */
  code: string;
  kind: MermaidDiagramKind;
  title?: string;
  onClose: () => void;
  /** 应用修改（写回 PRD）；缺省时「应用」「还原」不可用 */
  onApply?: (newCode: string) => void;
  /** 预览渲染器注入点（测试用） */
  renderer?: MermaidRenderer;
}

export function MermaidEditorModal({
  code,
  kind,
  title,
  onClose,
  onApply,
  renderer,
}: MermaidEditorModalProps) {
  const [draft, setDraft] = useState(code);
  const [applied, setApplied] = useState(false);
  /**
   * 打开编辑器那一刻的源码即「AI 初始图谱」。
   * 必须冻结：应用修改后父层的 `code` 会随之变成新版，若拿实时的 `code` 当基准，
   * 「还原」就会还原成刚应用过的版本 —— 等于没还原。
   */
  const [initialCode] = useState(code);
  /** 已同步到 PRD 的版本（应用 / 还原后更新），用于判断「未同步」 */
  const [syncedCode, setSyncedCode] = useState(code);
  /** W27：语法校对的反馈（修了几处 / 无需修补），短暂显示 */
  const [sanitizeNote, setSanitizeNote] = useState<string | null>(null);

  const diagnostics = useMemo(() => diagnoseMermaid(draft), [draft]);
  const blocking = hasBlockingDiagnostic(diagnostics);
  const dirty = draft !== syncedCode;
  const canApply = Boolean(onApply) && draft.trim() !== "" && !blocking;

  function apply() {
    if (!canApply) return;
    onApply?.(draft);
    setSyncedCode(draft);
    setApplied(true);
    window.setTimeout(() => setApplied(false), 2000);
  }

  /** 还原：编辑区与 PRD 一起回到打开编辑器时的 AI 初版（等价于撤销本次编辑） */
  function revert() {
    if (!onApply) return;
    setDraft(initialCode);
    setSyncedCode(initialCode);
    onApply(initialCode);
  }

  /** W27：语法校对 —— 修补畸形源码（补头 / 纠边符号 / 规范化节点 id / 清悬空箭头） */
  function applySanitize() {
    const { fixedCode, isFixed, fixLogs } = sanitizeMermaidSyntax(draft);
    setDraft(fixedCode);
    setSanitizeNote(
      isFixed
        ? `已自动修复 ${fixLogs.length} 处语法：${fixLogs.join("；")}`
        : "语法已规范，无需修补",
    );
    window.setTimeout(() => setSanitizeNote(null), 4000);
  }

  /** W27：一键整理布局 —— 规范化缩进与箭头间距 */
  function applyLayout() {
    setDraft((current) => optimizeDiagramLayout(current));
    setSanitizeNote(null);
  }

  const quickButton =
    "rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition hover:border-gray-400 dark:border-gray-700 dark:text-gray-300";

  return (
    <div
      data-mermaid-editor
      role="dialog"
      aria-modal="true"
      aria-label="编辑图谱"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-sm font-semibold">编辑图谱</h2>
            {title && (
              <span className="truncate text-xs text-gray-400">{title}</span>
            )}
            {dirty && (
              <span
                data-editor-dirty
                className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                未同步
              </span>
            )}
          </div>
          <button
            type="button"
            data-editor-action="close"
            onClick={onClose}
            aria-label="关闭"
            className="rounded px-2 py-0.5 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
          {kind === "flowchart" && (
            <button
              type="button"
              data-editor-action="add-node"
              onClick={() => setDraft((d) => appendNode(d))}
              className={quickButton}
            >
              + 添加节点
            </button>
          )}
          {kind === "state" && (
            <button
              type="button"
              data-editor-action="add-state"
              onClick={() => setDraft((d) => appendState(d))}
              className={quickButton}
            >
              + 添加状态
            </button>
          )}
          <button
            type="button"
            data-editor-action="format"
            onClick={() => setDraft((d) => formatDiagram(d))}
            className={quickButton}
          >
            格式化代码
          </button>
          {/* W27：语法校对与布局整理 */}
          <button
            type="button"
            data-editor-action="sanitize"
            onClick={applySanitize}
            className={quickButton}
          >
            语法校对 (Sanitize)
          </button>
          <button
            type="button"
            data-editor-action="optimize"
            onClick={applyLayout}
            className={quickButton}
          >
            一键整理布局
          </button>
          <span className="ml-auto text-[11px] text-gray-400">
            Mermaid 语法 · 修改后需「应用」才会同步到 PRD
          </span>
        </div>

        {sanitizeNote && (
          <p
            data-editor-sanitize-note
            className="border-b border-gray-200 bg-blue-50 px-4 py-1.5 text-[11px] text-blue-800 dark:border-gray-800 dark:bg-blue-950 dark:text-blue-200"
          >
            {sanitizeNote}
          </p>
        )}

        <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              图谱源码
            </span>
            <textarea
              data-editor-source
              aria-label="图谱源码"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-40 flex-1 resize-none rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800 outline-none focus:border-gray-500 dark:border-gray-700 dark:bg-black dark:text-gray-200"
            />
            {diagnostics.length > 0 ? (
              <ul
                data-editor-diagnostics
                className="max-h-28 overflow-auto rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                {diagnostics.map((d, i) => (
                  <li key={i} data-diagnostic-severity={d.severity}>
                    {d.line !== null ? `第 ${d.line} 行：` : ""}
                    {d.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p
                data-editor-diagnostics-ok
                className="text-[11px] text-green-700 dark:text-green-400"
              >
                未发现语法问题
              </p>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              实时预览
            </span>
            <div
              data-editor-preview
              className="min-h-40 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950"
            >
              <EditorPreview code={draft} renderer={renderer} />
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <button
            type="button"
            data-editor-action="apply"
            onClick={apply}
            disabled={!canApply}
            className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {applied ? "已同步至 PRD" : "应用修改并同步至 PRD"}
          </button>
          <button
            type="button"
            data-editor-action="revert"
            onClick={revert}
            disabled={!onApply}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:border-gray-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200"
          >
            还原为 AI 初始图谱
          </button>
          <span className="ml-auto text-[11px] text-gray-400">
            {draft.trim() === ""
              ? "源码为空，无法应用"
              : blocking
                ? `存在 ${diagnostics.filter((d) => d.severity === "error").length} 项语法错误，请先修正再应用`
                : "语法检查通过"}
          </span>
        </footer>
      </div>
    </div>
  );
}
