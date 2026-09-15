/**
 * Mermaid 代码块提取与图形类型判定（W15，纯函数）。
 *
 * Agent 产出是 Markdown，图谱以 ```mermaid 围栏嵌在正文里；
 * 展示层需要把围栏单独取出交给渲染器，正文里不再残留围栏标记。
 * 纯函数 —— 可脱离 DOM 与 mermaid 运行时单测。
 */

export type MermaidDiagramKind = "flowchart" | "state" | "other";

export interface MermaidBlock {
  /** 在原文中的出现序号（0 起），用于生成稳定的 DOM id */
  index: number;
  code: string;
  kind: MermaidDiagramKind;
}

/**
 * mermaid 围栏的正则**源码**（单一事实来源）。
 *
 * 只匹配完整围栏；未闭合的围栏不匹配（不吞后续正文）。
 * 导出「源码字符串」而非 RegExp 实例：`/g` 正则有 lastIndex 状态，
 * 多模块共享同一实例会在 `exec` 交替调用时互相串扰；
 * 各调用方用 `new RegExp(MERMAID_FENCE_PATTERN, "g")` 各持一份即可。
 */
export const MERMAID_FENCE_PATTERN = "```mermaid[ \\t]*\\r?\\n([\\s\\S]*?)```";

const MERMAID_FENCE = new RegExp(MERMAID_FENCE_PATTERN, "g");

/** 带原文偏移的 mermaid 围栏（供「就地替换」类编辑使用） */
export interface MermaidSpan extends MermaidBlock {
  /** 整个围栏（含 ```mermaid 声明行与收尾 ```）在原文中的起始下标 */
  start: number;
  /** 结束下标（不含） */
  end: number;
}

/**
 * 提取全部 mermaid 围栏，并带出各自在原文中的下标区间。
 * 与 `extractMermaidBlocks` 共用同一正则源码，二者的序号 / 内容必然一致。
 */
export function extractMermaidSpans(markdown: string): MermaidSpan[] {
  return Array.from(
    markdown.matchAll(new RegExp(MERMAID_FENCE_PATTERN, "g")),
    (match, index) => {
      const start = match.index ?? 0;
      const code = (match[1] ?? "").trim();
      return {
        index,
        start,
        end: start + match[0].length,
        code,
        kind: detectDiagramKind(code),
      };
    },
  );
}

/**
 * 由首行有效声明判定图形类型（mermaid 的语法关键字）。
 * 容错：允许前置空行与 `%%` 注释行。
 */
export function detectDiagramKind(code: string): MermaidDiagramKind {
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("%%")) continue;
    if (/^(flowchart|graph)\b/i.test(line)) return "flowchart";
    if (/^stateDiagram(-v2)?\b/i.test(line)) return "state";
    return "other";
  }
  return "other";
}

/** 提取正文中的全部 mermaid 围栏 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  return Array.from(markdown.matchAll(MERMAID_FENCE), (match, index) => {
    const code = (match[1] ?? "").trim();
    return { index, code, kind: detectDiagramKind(code) };
  });
}

/** 去掉 mermaid 围栏，保留其余正文（供正文与图谱分开展示） */
export function stripMermaidBlocks(markdown: string): string {
  return markdown
    .replace(MERMAID_FENCE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 是否为受支持的图形类型（flowchart / state） */
export function isSupportedDiagram(kind: MermaidDiagramKind): boolean {
  return kind === "flowchart" || kind === "state";
}
