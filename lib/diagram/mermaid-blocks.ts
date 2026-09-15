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

/** 只匹配 ```mermaid 围栏；未闭合的围栏不匹配（不吞后续正文） */
const MERMAID_FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/g;

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
