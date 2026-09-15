import { detectDiagramKind } from "./mermaid-blocks";

/**
 * Mermaid 源码的快捷编辑操作（W19，纯函数）。
 *
 * 供编辑器工具栏的「+ 添加节点 / + 添加状态 / 格式化代码」使用。
 * 全部是「文本进、文本出」的纯函数：可单测、无副作用，组件只负责把结果放回编辑区。
 * 对不属于自身图形类型的源码一律**原样返回**（防御性 no-op，避免把状态图改坏）。
 */

const DECLARATION_LINE =
  /^(flowchart|graph|stateDiagram(-v2)?|sequenceDiagram|classDiagram(-v2)?|erDiagram)\b/i;

/** 去掉 `|标签|` 后按箭头切分，便于取边两端的节点名 */
const ARROW = /\s*(?:-{2,}>|-\.->|={2,}>|--+|==+|-->)\s*/;

/** 收集 flowchart 里出现过的节点 id（按出现顺序，去重） */
function collectFlowchartIds(code: string): string[] {
  const ids: string[] = [];
  const push = (id: string) => {
    if (id && !ids.includes(id)) ids.push(id);
  };

  for (const raw of code.split(/\r?\n/)) {
    const t = raw.replace(/\|[^|]*\|/g, " ").trim();
    if (!t || t.startsWith("%%") || DECLARATION_LINE.test(t)) continue;

    // 边两侧的端点
    for (const part of t.split(ARROW)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(part.trim());
      if (m) push(m[1]);
    }
    // 节点定义：ID[ / ID( / ID{
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\s*[\[({]/.exec(t);
    if (def) push(def[1]);
  }
  return ids;
}

/** 收集 stateDiagram 里出现过的状态名（按出现顺序，去重，排除 [*]） */
function collectStateNames(code: string): string[] {
  const names: string[] = [];
  const push = (n: string) => {
    if (n && n !== "[*]" && !names.includes(n)) names.push(n);
  };

  for (const raw of code.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("%%") || DECLARATION_LINE.test(t)) continue;
    if (/^direction\b/i.test(t)) continue;

    const trans = /^(\[\*\]|[^\s:]+)\s*-->\s*(\[\*\]|[^\s:]+)/.exec(t);
    if (trans) {
      push(trans[1]);
      push(trans[2]);
      continue;
    }
    const alias = /^state\s+"[^"]*"\s+as\s+([^\s{]+)/.exec(t);
    if (alias) {
      push(alias[1]);
      continue;
    }
    const composite = /^state\s+([^\s{]+)\s*\{?$/.exec(t);
    if (composite) {
      push(composite[1]);
      continue;
    }
    const desc = /^([^\s:]+)\s*:/.exec(t);
    if (desc) push(desc[1]);
  }
  return names;
}

/** 生成未占用的编号名（`N1` / `新状态1` …） */
function nextName(prefix: string, used: string[]): string {
  for (let i = 1; i < 1000; i++) {
    const candidate = `${prefix}${i}`;
    if (!used.includes(candidate)) return candidate;
  }
  return `${prefix}${used.length + 1}`;
}

/** 统一换行为 \n，去掉行尾空白 */
function splitLines(code: string): string[] {
  return (code ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
}

/**
 * 格式化：统一行尾、去掉首尾空行、折叠连续空行，声明行顶格、其余行缩进两格。
 * mermaid 不依赖缩进，因此这一步只影响可读性、不改语义。
 */
export function formatDiagram(code: string): string {
  const lines = splitLines(code);
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(out.length === 0 ? line.trim() : `  ${line.trim()}`);
  }
  return out.join("\n");
}

function appendLines(code: string, lines: string[]): string {
  const base = (code ?? "").replace(/\s+$/, "");
  return `${base}\n${lines.join("\n")}\n`;
}

/** 「+ 添加节点」：追加一个新节点，并在已有入口节点后连一条边 */
export function appendNode(code: string): string {
  if (detectDiagramKind(code) !== "flowchart") return code;
  const ids = collectFlowchartIds(code);
  const fresh = nextName("N", ids);
  const anchor = ids[0];
  const lines = [`  ${fresh}[新节点]`];
  if (anchor) lines.push(`  ${anchor} --> ${fresh}`);
  return appendLines(code, lines);
}

/** 「+ 添加状态」：追加一个新状态，并从已有状态连一条转换（无锚点时用 state 声明） */
export function appendState(code: string): string {
  if (detectDiagramKind(code) !== "state") return code;
  const names = collectStateNames(code);
  const fresh = nextName("新状态", names);
  const anchor = names[0];
  const lines = anchor ? [`  ${anchor} --> ${fresh}`] : [`  state ${fresh}`];
  return appendLines(code, lines);
}
