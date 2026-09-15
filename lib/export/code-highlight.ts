/**
 * 零依赖语法高亮（W18）。
 *
 * 为 XState 导出弹窗提供 JSON / TypeScript 的**语法高亮数据**：把源码切成带类型的 token 流，
 * 由 React 渲染成 <span>（不做 dangerouslySetInnerHTML，天然免疫注入）。
 *
 * 为什么自研而不引 prism/highlight.js/shiki：本仓刻意保持依赖精简，且这里只需两种语言、
 * 只需「够用的着色」。纯函数 → 可单测，核心不变量是 **token 拼接必须逐字还原输入**
 * （不得吞字或重复），这条断言比逐个 token 断言更能防住扫描器回归。
 */

export type TokenType =
  | "comment"
  | "string"
  | "property"
  | "number"
  | "boolean"
  | "keyword"
  | "punctuation"
  | "plain";

export interface Token {
  type: TokenType;
  value: string;
}

export type HighlightLanguage = "json" | "ts";

const TS_KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "function",
  "return", "new", "type", "interface", "as", "if", "else", "for", "while",
  "await", "async", "this", "satisfies", "typeof", "extends", "implements",
]);

interface ScannerOptions {
  lineComment?: boolean;
  blockComment?: boolean;
  templateString?: boolean;
  keywords?: Set<string>;
  jsonLiterals?: boolean;
  markPropertyKeys?: boolean;
}

/**
 * 追加 token。
 * 刻意**不做相邻同类合并**：合并会把前导空白并进标识符（`" createMachine"`）、
 * 把 `{}` 并成单个标点，使 token 流不可预期、也让按值查找变得不可靠。
 * 逐单位一个 token 更可预测，渲染开销对本场景可忽略。
 */
function push(tokens: Token[], type: TokenType, value: string): void {
  if (!value) return;
  tokens.push({ type, value });
}

/** 从字符串起始处扫描一个字面量（含未闭合的情形），返回其原始文本 */
function scanString(rest: string, quote: string, allowNewline: boolean): string {
  let i = 1;
  while (i < rest.length) {
    const c = rest[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) {
      i += 1;
      break;
    }
    if (!allowNewline && c === "\n") break;
    i += 1;
  }
  return rest.slice(0, Math.min(i, rest.length));
}

function scan(code: string, options: ScannerOptions): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const rest = code.slice(i);
    const ch = code[i];

    const ws = /^\s+/.exec(rest);
    if (ws) {
      push(tokens, "plain", ws[0]);
      i += ws[0].length;
      continue;
    }

    if (options.lineComment && rest.startsWith("//")) {
      const m = /^\/\/[^\n]*/.exec(rest)!;
      push(tokens, "comment", m[0]);
      i += m[0].length;
      continue;
    }

    if (options.blockComment && rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      const text = end >= 0 ? rest.slice(0, end + 2) : rest;
      push(tokens, "comment", text);
      i += text.length;
      continue;
    }

    if (ch === '"' || ch === "'" || (options.templateString && ch === "`")) {
      const text = scanString(rest, ch, ch === "`");
      const isKey =
        options.markPropertyKeys && /^\s*:/.test(code.slice(i + text.length));
      push(tokens, isKey ? "property" : "string", text);
      i += text.length;
      continue;
    }

    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      push(tokens, "number", num[0]);
      i += num[0].length;
      continue;
    }

    const ident = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
    if (ident) {
      const word = ident[0];
      if (options.keywords?.has(word)) push(tokens, "keyword", word);
      else if (
        options.jsonLiterals &&
        (word === "true" || word === "false" || word === "null")
      )
        push(tokens, "boolean", word);
      else push(tokens, "plain", word);
      i += word.length;
      continue;
    }

    push(tokens, "punctuation", ch);
    i += 1;
  }

  return tokens;
}

/** JSON 高亮 token 流（键标为 property，便于着色区分） */
export function highlightJson(code: string): Token[] {
  return scan(code, { jsonLiterals: true, markPropertyKeys: true });
}

/** TypeScript 高亮 token 流（行注释 / 块注释 / 模板串 / 关键字） */
export function highlightTypeScript(code: string): Token[] {
  return scan(code, {
    lineComment: true,
    blockComment: true,
    templateString: true,
    keywords: TS_KEYWORDS,
  });
}

export function tokenize(code: string, language: HighlightLanguage): Token[] {
  return language === "json" ? highlightJson(code) : highlightTypeScript(code);
}
