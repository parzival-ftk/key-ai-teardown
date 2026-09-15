import type { ComparisonRow, EvalRun } from "./baseline";
import {
  DEFAULT_GATE_THRESHOLD,
  EVAL_DIMENSIONS,
} from "@/lib/eval/dimensions";

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

/* ────────────────────── 终端质量评估表（W14） ────────────────────── */

/** 宽字符（CJK / 全角）按 2 列计，否则终端表格对不齐 */
const WIDE_CHAR =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** 文本在等宽终端里占用的列数 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += WIDE_CHAR.test(ch) ? 2 : 1;
  return width;
}

/** 按终端显示宽度右补空格 */
export function padDisplay(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

export interface QualityGateResult {
  threshold: number;
  average: number;
  /** 综合分低于阈值的样例名 */
  failedSamples: string[];
  passed: boolean;
}

/** 门禁判定：**平均分 ≥ 阈值且无样例低于阈值**才算通过 */
export function qualityGate(
  run: EvalRun,
  threshold: number = DEFAULT_GATE_THRESHOLD,
): QualityGateResult {
  const failedSamples = run.results
    .filter((r) => r.overall < threshold)
    .map((r) => r.name);
  const average = averageScore(run);
  return {
    threshold,
    average,
    failedSamples,
    passed: run.results.length > 0 && average >= threshold && failedSamples.length === 0,
  };
}

/**
 * 渲染终端「质量评估表」：每个样例一行，列为 4 个维度 + 综合分 + 门禁。
 * 维度缺失（judge 未给分）显示 —，不假装 0 分。
 */
export function renderQualityTable(
  run: EvalRun,
  threshold: number = DEFAULT_GATE_THRESHOLD,
): string {
  const header = [
    "样例",
    ...EVAL_DIMENSIONS.map((d) => d.nameEn),
    "Composite",
    "Gate",
  ];
  const rows = run.results.map((r) => [
    r.name,
    ...EVAL_DIMENSIONS.map((d) =>
      typeof r.scores[d.id] === "number" ? String(r.scores[d.id]) : "—",
    ),
    String(r.overall),
    r.overall >= threshold ? "PASS" : "FAIL",
  ]);

  const widths = header.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ""))),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => padDisplay(c, widths[i])).join("  ");

  const gate = qualityGate(run, threshold);
  const out = [
    `质量评估（门禁阈值 ${threshold} 分）`,
    line(header),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.map(line),
    widths.map((w) => "-".repeat(w)).join("  "),
    line([
      "平均",
      ...EVAL_DIMENSIONS.map(() => ""),
      String(gate.average),
      gate.passed ? "PASS" : "FAIL",
    ]),
  ];

  if (!gate.passed) {
    out.push(
      gate.failedSamples.length > 0
        ? `门禁未过：${gate.failedSamples.join("、")} 低于 ${threshold} 分。`
        : `门禁未过：平均分 ${gate.average} < ${threshold}。`,
    );
  }
  return out.join("\n");
}
