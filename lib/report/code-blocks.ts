/**
 * Markdown 代码围栏提取（W6）。
 *
 * 「界面代码」Agent 的产出是「说明文字 + ```html 围栏」的 Markdown；展示层需要把
 * 围栏内的代码单独取出，用代码面板渲染（可一键复制），而不是当普通段落贴出来。
 * 纯函数，便于单测。
 */

export interface CodeBlock {
  /** 围栏语言标识（如 "html"）；未标注时为空串 */
  lang: string;
  /** 围栏内代码（首尾空白已去除） */
  code: string;
}

/** 匹配 ```lang\n…``` —— 未闭合的围栏不匹配（不吞掉后续正文） */
const FENCE = /```([\w-]*)[ \t]*\r?\n([\s\S]*?)```/g;

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  return Array.from(markdown.matchAll(FENCE), (m) => ({
    lang: m[1] ?? "",
    code: (m[2] ?? "").trim(),
  }));
}

/** 去掉所有代码围栏（保留围栏外的说明文字），供正文与代码面板分开展示 */
export function stripCodeBlocks(markdown: string): string {
  return markdown
    .replace(/```([\w-]*)[ \t]*\r?\n([\s\S]*?)```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
