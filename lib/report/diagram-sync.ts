import {
  MERMAID_FENCE_PATTERN,
  extractMermaidSpans,
} from "@/lib/diagram/mermaid-blocks";

/**
 * W19 · PRD ↔ Mermaid 双向同步引擎（纯函数）。
 *
 * 场景：报告页允许用户在「图谱编辑器」里改动某张 Mermaid 图，改完必须写回该段 PRD 的
 * Markdown 文本 —— 因为 PRD 文本同时是**展示源**（`[Cn]` 追溯锚点、正文段落）、
 * **渲染源**（图谱重绘）与**导出源**（Markdown / Issues / Figma / XState）。
 *
 * 因此本模块的硬约束是**不变量保护**：只替换目标围栏内部，其余一切（段落标题、正文、
 * `[Cn]` 锚点、其它图谱）逐字不变。做不到这一点，「编辑图谱」就会静默破坏溯源链。
 *
 * 与 `extractMermaidBlocks` 共用同一正则源码（`MERMAID_FENCE_PATTERN`），
 * 保证「序号」在两处含义完全一致 —— 这是 UI 侧 `block.index` 能直接当 `targetIndex` 用的前提。
 */

/** 用于识别「用户把整段围栏贴进来了」的情形 */
const WRAPPED_FENCE = new RegExp(`^\\s*${MERMAID_FENCE_PATTERN}\\s*$`);

/**
 * 规范化图谱源码：剥掉可能被一并粘贴进来的围栏，去掉首尾空白。
 * 保留内部换行与缩进（那是源码的一部分）。
 */
function normalizeMermaidBody(code: string): string {
  const wrapped = WRAPPED_FENCE.exec(code ?? "");
  const body = wrapped ? (wrapped[1] ?? "") : (code ?? "");
  return body.trim();
}

/** 该段 PRD 文本里有多少个 mermaid 围栏 */
export function countMermaidBlocks(prdMarkdown: string): number {
  return extractMermaidSpans(prdMarkdown ?? "").length;
}

/** 取第 targetIndex 个图谱的源码；越界 / 非法序号返回 null */
export function getMermaidCodeAt(
  prdMarkdown: string,
  targetIndex: number,
): string | null {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return null;
  return extractMermaidSpans(prdMarkdown ?? "")[targetIndex]?.code ?? null;
}

export interface MermaidUpdateResult {
  markdown: string;
  /** 是否命中目标围栏（false = 序号越界 / 该段没有图谱，原文原样返回） */
  applied: boolean;
}

/**
 * 把第 targetIndex 个 mermaid 围栏的内容替换为 `newMermaidCode`。
 * 越界或该段没有图谱时返回 `applied: false` 且 markdown 原样 —— 供 UI 区分
 * 「已同步」与「目标不存在」，避免静默失败。
 */
export function tryUpdateMermaidInPrd(
  prdMarkdown: string,
  targetIndex: number,
  newMermaidCode: string,
): MermaidUpdateResult {
  const markdown = prdMarkdown ?? "";
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    return { markdown, applied: false };
  }
  const span = extractMermaidSpans(markdown)[targetIndex];
  if (!span) return { markdown, applied: false };

  const replacement = `\`\`\`mermaid\n${normalizeMermaidBody(newMermaidCode)}\n\`\`\``;
  return {
    markdown:
      markdown.slice(0, span.start) + replacement + markdown.slice(span.end),
    applied: true,
  };
}

/**
 * 主入口（规格签名）：替换 PRD 中第 targetIndex 个 mermaid 围栏的内容。
 * 只动目标围栏内部；越界时返回原文（保护性 no-op）。
 */
export function updateMermaidInPrd(
  prdMarkdown: string,
  targetIndex: number,
  newMermaidCode: string,
): string {
  return tryUpdateMermaidInPrd(prdMarkdown, targetIndex, newMermaidCode).markdown;
}
