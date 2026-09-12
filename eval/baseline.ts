import type { DimensionScores } from "./rubric";

/**
 * 质量门禁 eval —— 基线与对比。
 *
 * 一次 eval 运行的结果序列化为 JSON 存为「基线」；下一次运行加载基线与当前对比，
 * 得到「改动前 / 后」的分数变化表（W9 验收：npm run eval 输出质量对比表）。
 *
 * 纯函数为主：解析容错（坏文件 → null）、对比为纯计算，便于单测。
 */

export interface EvalSampleResult {
  id: string;
  name: string;
  /** 各维度得分 */
  scores: DimensionScores;
  /** 加权总分（0-100） */
  overall: number;
}

export interface EvalRun {
  /** 运行时间（ISO 字符串） */
  createdAt: string;
  /** 被测 / 评审模型标识 */
  model: string;
  results: EvalSampleResult[];
}

/** 序列化为带缩进的 JSON（写盘用） */
export function serializeRun(run: EvalRun): string {
  return JSON.stringify(run, null, 2);
}

function isSampleResult(value: unknown): value is EvalSampleResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.overall === "number" &&
    !!r.scores &&
    typeof r.scores === "object"
  );
}

/**
 * 解析基线 JSON。任何不满足最小形状的输入（null / 空串 / 坏 JSON / 缺 results）
 * 一律返回 null —— 调用方据此视为「无基线」，而不是崩溃。
 */
export function parseRun(json: string | null | undefined): EvalRun | null {
  if (!json) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  if (!Array.isArray(record.results)) return null;

  const results = record.results.filter(isSampleResult);
  return {
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    model: typeof record.model === "string" ? record.model : "",
    results,
  };
}

export interface ComparisonRow {
  id: string;
  name: string;
  /** 当前运行的总分 */
  current: number;
  /** 基线总分；基线缺失该样例时为 null */
  baseline: number | null;
  /** current - baseline；无基线时为 null */
  delta: number | null;
}

/**
 * 对比当前运行与基线：按样例 id 对齐，计算每个样例的总分变化。
 * baseline 为 null（首次运行）时，所有基线列与 delta 均为 null。
 */
export function compareRuns(
  current: EvalRun,
  baseline: EvalRun | null,
): ComparisonRow[] {
  const baselineByid = new Map(
    (baseline?.results ?? []).map((r) => [r.id, r.overall]),
  );
  return current.results.map((r) => {
    const base = baselineByid.has(r.id) ? baselineByid.get(r.id)! : null;
    return {
      id: r.id,
      name: r.name,
      current: r.overall,
      baseline: base,
      delta: base === null ? null : r.overall - base,
    };
  });
}
