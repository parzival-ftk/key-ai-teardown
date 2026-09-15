/**
 * Mermaid 源码的**启发式**诊断（W19，纯函数）。
 *
 * 定位：给编辑器提供同步、零依赖、可单测的即时提示（空源码、缺声明、括号/引号不配对）。
 * 它**不是**语法权威 —— mermaid 自己的解析器才是。编辑器同时展示渲染器的报错，
 * 二者组合覆盖「即时提示」与「权威判定」；这里刻意只做保守检查，宁可漏报不误报。
 */

export type DiagnosticSeverity = "error" | "warning";

export interface DiagramDiagnostic {
  severity: DiagnosticSeverity;
  /** 1 起的行号；null 表示整体性问题 */
  line: number | null;
  message: string;
}

/** mermaid 支持的图形声明关键字（用于判定「首行是否有效」） */
const DECLARATION =
  /^(flowchart|graph|stateDiagram(-v2)?|sequenceDiagram|classDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|xychart(-beta)?|block(-beta)?|sankey(-beta)?|requirementDiagram|C4\w+|zenuml|kanban|radar(-beta)?|treemap(-beta)?)\b/i;

/** 去掉行内成对引号内容后再查括号，避免把标签文本里的括号算进来 */
function stripQuoted(line: string): string {
  return line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

/**
 * 是否为 markdown 代码围栏行（``` / ```mermaid）。
 * 这类行不参与「图形声明」与括号校验 —— 否则用户粘贴整段围栏时，
 * 围栏本身会被误判成「缺少图形声明」，把真正的问题淹掉。
 */
function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line);
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

/** 诊断 mermaid 源码；无问题返回空数组。绝不抛错。 */
export function diagnoseMermaid(code: string): DiagramDiagnostic[] {
  const source = code ?? "";
  const diagnostics: DiagramDiagnostic[] = [];

  if (source.trim() === "") {
    return [{ severity: "error", line: null, message: "图谱源码为空" }];
  }

  const lines = source.split(/\r?\n/);

  // 1) 围栏残留（编辑器只编辑围栏内部）
  if (source.includes("```")) {
    diagnostics.push({
      severity: "warning",
      line: null,
      message: "源码里包含 ``` 围栏标记，编辑区只需围栏内部的图谱源码",
    });
  }

  // 2) 首行有效声明
  const contentLines = lines.filter(
    (l) => l.trim() !== "" && !l.trim().startsWith("%%") && !isFenceLine(l),
  );
  const firstContent = lines.findIndex(
    (l) => l.trim() !== "" && !l.trim().startsWith("%%") && !isFenceLine(l),
  );
  if (contentLines.length === 0) {
    return [{ severity: "error", line: null, message: "图谱源码为空" }];
  }
  if (!DECLARATION.test(contentLines[0].trim())) {
    diagnostics.push({
      severity: "error",
      line: firstContent + 1,
      message:
        "缺少图形声明（如 flowchart TD、stateDiagram-v2），mermaid 无法识别图谱类型",
    });
  }

  // 3) 逐行括号配对与引号闭合（围栏行跳过）
  lines.forEach((raw, i) => {
    if (isFenceLine(raw)) return;
    const line = stripQuoted(raw);
    const pairs: [string, string, string][] = [
      ["[", "]", "方括号"],
      ["(", ")", "圆括号"],
      ["{", "}", "花括号"],
    ];
    for (const [open, close, label] of pairs) {
      const diff = countChar(line, open) - countChar(line, close);
      if (diff !== 0) {
        diagnostics.push({
          severity: "error",
          line: i + 1,
          message: `${label}不配对（${open} ×${countChar(line, open)} / ${close} ×${countChar(line, close)}）`,
        });
      }
    }
    if (countChar(raw, '"') % 2 !== 0) {
      diagnostics.push({
        severity: "error",
        line: i + 1,
        message: "双引号未闭合",
      });
    }
  });

  return diagnostics;
}

/** 是否存在阻断性问题（用于「应用」前的门禁提示） */
export function hasBlockingDiagnostic(
  diagnostics: DiagramDiagnostic[],
): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
