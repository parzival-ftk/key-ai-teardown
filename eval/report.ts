import type { ComparisonRow, EvalRun } from "./baseline";

/**
 * 质量门禁 eval —— 报告渲染（纯文本 / Markdown）。
 *
 * 与「跑 LLM」解耦，便于单测，也让 CLI 只负责接线。
 */

/** 单行 delta 展示：正数带 +，null 显示 — */
function formatDelta(delta: number | null): string {
  if (delta === null) return "—";
  return delta > 0 ? `+${delta}` : String(delta);
}

/**
 * 渲染「改动前 / 后」对比表（Markdown 表格）。
 * 基线缺失的样例基线列显示 —，变化列也显示 —（不假装有对比）。
 */
export function renderComparisonTable(rows: ComparisonRow[]): string {
  const header = ["样例", "基线", "当前", "变化"];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    const base = row.baseline === null ? "—" : String(row.baseline);
    lines.push(
      `| ${row.name} | ${base} | ${row.current} | ${formatDelta(row.delta)} |`,
    );
  }
  return lines.join("\n");
}

/** 平均总分（0-100，四舍五入）；无样例返回 0 */
export function averageScore(run: EvalRun): number {
  if (run.results.length === 0) return 0;
  const sum = run.results.reduce((acc, r) => acc + r.overall, 0);
  return Math.round(sum / run.results.length);
}

/** 运行摘要（时间 / 模型 / 样例数 / 平均分） */
export function renderRunSummary(run: EvalRun): string {
  return [
    `运行时间：${run.createdAt || "（未记录）"}`,
    `模型：${run.model || "（未标注）"}`,
    `样例数：${run.results.length}`,
    `平均分：${averageScore(run)}`,
  ].join("\n");
}
