/**
 * Mermaid 语法自动修补引擎（W27，纯函数）。
 *
 * 模型产出的图谱常常「差一点就能渲染」：漏了图表类型头、把 sequence 的 `->>`
 * 写进了 flowchart、节点 id 里带空格或中文、行尾留半个箭头。本模块把这类畸形
 * 就地修正，并逐条记录改了什么（`fixLogs`），让用户看得见、可复核。
 *
 * 修补四件事（与规格一一对应）：
 *   1. 补全缺失的图表类型头（默认 `flowchart TD`）
 *   2. flowchart 中的 Sequence 边符号 `->>` / `-->>` → `-->`（sequenceDiagram 里合法，不动）
 *   3. 规范化节点声明：id 纯化为字母数字下划线，中文/特殊符号移入 `[...]` 标签
 *   4. 清理多余空行与行尾悬空连接符
 *
 * 纪律：绝不抛错；**幂等**（对修补结果再跑一次不再产生修改）；不触碰方括号标签内部；
 * 不负责缩进/排版（那是 `layout-optimizer` 的职责，两者可串联）。
 */

import { mermaidArrowPattern } from "./mermaid-blocks";

export interface SanitizeResult {
  fixedCode: string;
  /** 是否发生了任何修改 */
  isFixed: boolean;
  /** 人类可读的修补记录 */
  fixLogs: string[];
}

const EMPTY: SanitizeResult = { fixedCode: "", isFixed: false, fixLogs: [] };

/** 图形声明关键字（首行判定） */
const DECLARATION =
  /^(flowchart|graph|stateDiagram(-v2)?|sequenceDiagram|classDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|gitGraph|C4Context|quadrantChart|timeline)\b/i;

/** 结构行：不参与节点/边解析 */
const STRUCTURAL =
  /^(subgraph|end|direction|classDef|class|style|linkStyle|click|note|accTitle|accDescr|state|section)\b/i;

const SHAPE_OPEN = /(\[\(|\[\[|\(\[|\{\{|\[\/|\[\\|\[|\(|\{)/;

/** flowchart 里必须纠正的 sequence 边符号 */
const SEQUENCE_ARROWS = new Set(["->>", "-->>"]);

/** 合法 id：纯字母数字下划线，且不以数字开头 */
const ASCII_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isHeaderLine(line: string): boolean {
  return DECLARATION.test(line.trim());
}

function isStructuralLine(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (text.startsWith("%%")) return true;
  return STRUCTURAL.test(text);
}

interface ChunkHead {
  /** 前导空白 */
  ws: string;
  /** 边标签 `|...|` */
  edgeLabel: string;
  id: string;
  /** 头部之后（形状及其标签，或无形状时的尾随文本） */
  rest: string;
  hasShape: boolean;
}

/** 解析一个非箭头文本块的头部 id */
function parseHead(chunk: string): ChunkHead | null {
  const shape = SHAPE_OPEN.exec(chunk);
  if (shape && shape.index !== undefined && shape.index > 0) {
    const before = chunk.slice(0, shape.index);
    const m = /^(\s*)(\|[^|]*\|\s*)?([\s\S]*)$/.exec(before);
    if (!m) return null;
    const id = m[3].trim();
    if (!id) return null;
    return {
      ws: m[1],
      edgeLabel: m[2] ?? "",
      id,
      rest: chunk.slice(shape.index),
      hasShape: true,
    };
  }
  // 无形状：首个空白分隔 token 即 id（裸引用的 id 不含空格）
  const m = /^(\s*)(\|[^|]*\|\s*)?([^\s\[\](){}<>|]+)/.exec(chunk);
  if (!m) return null;
  return {
    ws: m[1],
    edgeLabel: m[2] ?? "",
    id: m[3],
    rest: chunk.slice(m[0].length),
    hasShape: false,
  };
}

/** 去掉行尾悬空连接符：`A -->` → `A`；整行只剩箭头 → 空串 */
function dropDanglingArrow(parts: string[]): { parts: string[]; dropped: boolean } {
  const out = [...parts];
  let dropped = false;
  while (out.length >= 3 && out[out.length - 2] && out[out.length - 1].trim() === "") {
    out.splice(out.length - 2, 2);
    dropped = true;
  }
  return { parts: out, dropped };
}

/**
 * 自动修补 Mermaid 语法。
 *
 * @param rawCode 原始源码（可含围栏之外的多余文本吗？不 —— 调用方应先剥离围栏）
 *   空 / 非字符串 → 返回空结果；任何异常 → 返回原样，**绝不抛错**。
 */
export function sanitizeMermaidSyntax(rawCode: string): SanitizeResult {
  if (typeof rawCode !== "string" || rawCode.trim() === "") return EMPTY;

  try {
    const source = rawCode.replace(/\r\n?/g, "\n");
    const fixLogs: string[] = [];

    /* 1) 图表类型头 */
    const rawLines = source.split("\n");
    const firstContent = rawLines.findIndex(
      (l) => l.trim() !== "" && !l.trim().startsWith("%%"),
    );
    const hasHeader =
      firstContent >= 0 && isHeaderLine(rawLines[firstContent]);
    let lines = rawLines;
    if (!hasHeader) {
      const insertAt = firstContent < 0 ? rawLines.length : firstContent;
      lines = [
        ...rawLines.slice(0, insertAt),
        "flowchart TD",
        ...rawLines.slice(insertAt),
      ];
      fixLogs.push("补全图表类型头：flowchart TD");
    }
    const kind = hasHeader
      ? (rawLines[firstContent].trim().split(/[\s{[]/)[0] ?? "").toLowerCase()
      : "flowchart";
    const isFlowchart = kind === "flowchart" || kind === "graph";

    /* 2) 清理空行 */
    const beforeCount = lines.length;
    const contentLines: string[] = [];
    for (const line of lines) {
      if (line.trim() === "") continue;
      contentLines.push(line);
    }
    if (contentLines.length !== beforeCount) fixLogs.push("清理多余空行");

    /* 3) 收集需要重命名的 id（非 ASCII id）
     *    仅对 flowchart/graph —— 只有这类图的 `id[label]` 语法成立；
     *    stateDiagram 的状态名、sequenceDiagram 的 `A->>B: msg` 各有自己的
     *    行语法，套用 flowchart 的节点规则会把它们改坏。 */
    const rename = new Map<string, string>();
    const taken = new Set<string>();
    if (isFlowchart) {
      for (const line of contentLines) {
        if (isStructuralLine(line) || isHeaderLine(line)) continue;
        const parts = line.split(mermaidArrowPattern());
        for (let i = 0; i < parts.length; i += 2) {
          const head = parseHead(parts[i]);
          if (!head) continue;
          if (ASCII_ID.test(head.id)) taken.add(head.id);
        }
      }
      let seq = 1;
      for (const line of contentLines) {
        if (isStructuralLine(line) || isHeaderLine(line)) continue;
        const parts = line.split(mermaidArrowPattern());
        for (let i = 0; i < parts.length; i += 2) {
          const head = parseHead(parts[i]);
          if (!head || ASCII_ID.test(head.id)) continue;
          if (rename.has(head.id)) continue;
          let fresh = `N${seq++}`;
          while (taken.has(fresh)) fresh = `N${seq++}`;
          taken.add(fresh);
          rename.set(head.id, fresh);
        }
      }
    }
    if (rename.size > 0) {
      fixLogs.push(
        `规范化 ${rename.size} 个节点 ID（生成 ASCII id，中文/符号移入标签）`,
      );
    }

    /* 4) 重写各行：箭头纠正 + id 重命名 + 悬空连接符 */
    const labelled = new Set<string>();
    let arrowFixCount = 0;
    let danglingCount = 0;
    const out: string[] = [];

    for (const line of contentLines) {
      if (isStructuralLine(line) || isHeaderLine(line)) {
        out.push(line);
        continue;
      }
      const { parts, dropped } = dropDanglingArrow(
        line.split(mermaidArrowPattern()),
      );
      if (dropped) danglingCount += 1;

      let rebuilt = "";
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          const arrow = parts[i];
          if (isFlowchart && SEQUENCE_ARROWS.has(arrow)) {
            arrowFixCount += 1;
            rebuilt += "-->";
          } else {
            rebuilt += arrow;
          }
          continue;
        }
        const head = parseHead(parts[i]);
        if (!head) {
          rebuilt += parts[i];
          continue;
        }
        const fresh = rename.get(head.id);
        if (!fresh) {
          rebuilt += parts[i];
          continue;
        }
        // 首次出现且没有自己的标签 → 把原名装进方括号，信息不丢
        const needLabel = !head.hasShape && !labelled.has(head.id);
        if (needLabel) labelled.add(head.id);
        rebuilt +=
          head.ws + head.edgeLabel + fresh + (needLabel ? `[${head.id}]` : "") + head.rest;
      }
      const text = rebuilt.replace(/\s+$/, "");
      if (text.trim() !== "") out.push(text);
    }

    if (arrowFixCount > 0) {
      fixLogs.push(`纠正 ${arrowFixCount} 处 flowchart 非法边符号（->> → -->）`);
    }
    if (danglingCount > 0) {
      fixLogs.push(`移除 ${danglingCount} 处悬空连接符`);
    }

    const fixedCode = out.join("\n");
    return { fixedCode, isFixed: fixLogs.length > 0, fixLogs };
  } catch {
    return { fixedCode: rawCode, isFixed: false, fixLogs: [] };
  }
}
