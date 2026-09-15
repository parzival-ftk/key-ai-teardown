import { formatDiagram } from "./diagram-ops";
import { mermaidArrowPattern } from "./mermaid-blocks";

/**
 * 图谱布局优化器（W27，纯函数）。
 *
 * 两件事：
 *   - `changeDiagramDirection`：切换 flowchart / graph 的布局方向（TD / LR / TB / RL）；
 *   - `optimizeDiagramLayout`：规范化缩进与连线排版（复用 W19 的 `formatDiagram`，
 *     不重复实现缩进规则），并把箭头两侧收敛成单空格。
 *
 * 纪律：非 flowchart 的图形一律**原样返回**（状态图 / 时序图各有自己的行语法，
 * 套用 flowchart 的排版规则会改坏它们）；绝不抛错。
 */

export type DiagramDirection = "TD" | "LR" | "TB" | "RL";

const DIRECTIONS: readonly DiagramDirection[] = ["TD", "LR", "TB", "RL"];

const isDirection = (value: string): value is DiagramDirection =>
  (DIRECTIONS as readonly string[]).includes(value);

/** flowchart / graph 声明行（可带前导空白，方向为两个字母） */
const FLOWCHART_DECL = /^(\s*)(flowchart|graph)\s+([A-Za-z]{2})\s*$/i;

function firstContentLine(code: string): number {
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  return lines.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("%%"));
}

/** 当前布局方向；非 flowchart / 未声明方向 → null */
export function detectDiagramDirection(code: string): DiagramDirection | null {
  if (typeof code !== "string" || code.trim() === "") return null;
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  const index = firstContentLine(code);
  if (index < 0) return null;
  const match = FLOWCHART_DECL.exec(lines[index].trim());
  if (!match) return null;
  const dir = match[3].toUpperCase();
  return isDirection(dir) ? dir : null;
}

/**
 * 切换 flowchart / graph 的布局方向。
 * 非 flowchart、无方向声明、或方向已相同 → 原样返回。
 */
export function changeDiagramDirection(
  code: string,
  targetDirection: DiagramDirection,
): string {
  if (typeof code !== "string" || code.trim() === "") return "";
  if (!isDirection(targetDirection)) return code;

  try {
    const lines = code.replace(/\r\n?/g, "\n").split("\n");
    const index = firstContentLine(code);
    if (index < 0) return code;

    const match = FLOWCHART_DECL.exec(lines[index]);
    if (!match) return code;
    const keyword = match[2].toLowerCase();
    if (match[3].toUpperCase() === targetDirection) return code;

    lines[index] = `${match[1]}${keyword} ${targetDirection}`;
    return lines.join("\n");
  } catch {
    return code;
  }
}

/**
 * 把箭头两侧收敛成单空格：
 *   `A-->B` → `A --> B`，`A   -->   C` → `A --> C`；
 *   箭头后紧跟边标签时保持 `-->|标签|` 不插空格。
 *
 * 先把方括号/圆括号内容整体遮蔽，避免标签里的空格与符号被卷入；
 * 边标签 `|...|` 不在括号内，其与箭头的紧邻关系会被显式保留。
 */
function normalizeArrowSpacing(line: string): string {
  const labels: string[] = [];
  const masked = line.replace(
    /\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g,
    (match) => {
      labels.push(match);
      return `\u0000${labels.length - 1}\u0000`;
    },
  );

  const parts = masked.split(mermaidArrowPattern());
  if (parts.length === 1) return line; // 无箭头：原样（不经过遮蔽还原，避免任何改动）

  let out = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      if (out !== "" && !/\s$/.test(out)) out += " ";
      out += parts[i];
      continue;
    }
    let text = parts[i];
    if (i > 0) text = text.replace(/^\s+/, "");
    if (i + 1 < parts.length) text = text.replace(/\s+$/, "");
    if (text === "") continue;
    if (i > 0 && !text.startsWith("|")) out += " ";
    out += text;
  }

  return out.replace(/\u0000(\d+)\u0000/g, (_, idx) => labels[Number(idx)] ?? "");
}

/**
 * 规范化缩进与连线排版：统一行尾、折叠空行、声明顶格、其余缩进两格
 * （见 `formatDiagram`），再把每条语句的箭头间距收敛。
 *
 * 空 / 非字符串 → 空串；任何异常 → 返回原样。
 */
export function optimizeDiagramLayout(code: string): string {
  if (typeof code !== "string" || code.trim() === "") return "";
  try {
    return formatDiagram(code)
      .split("\n")
      .map((line) => {
        const text = line.trim();
        if (!text || text.startsWith("%%")) return line;
        return normalizeArrowSpacing(line);
      })
      .join("\n");
  } catch {
    return code;
  }
}
