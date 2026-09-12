import { z } from "zod";

/**
 * 证据标签（E2 · 差异化卖点）。
 * 每条结论标注其证据等级，用于治理 LLM 幻觉：
 * - verified：有明确来源支撑
 * - inferred：由推理得出，无直接来源
 * - missing：关键信息缺失，无法判断
 *
 * 独立成文件，供 types/agent.ts 与 types/events.ts 共用（避免循环依赖）。
 */
export const EvidenceLabelSchema = z.enum(["verified", "inferred", "missing"]);
export type EvidenceLabel = z.infer<typeof EvidenceLabelSchema>;

export const EvidenceSchema = z.object({
  /** 结论/声称内容 */
  claim: z.string(),
  /** 证据等级 */
  label: EvidenceLabelSchema,
  /** 来源（URL / 文档 / 数据点）；label = verified 时应有来源 */
  source: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** 证据标签计数（W2：可信度层贯通；W3：报告顶部总览条用） */
export interface EvidenceStats {
  verified: number;
  inferred: number;
  missing: number;
}

/** 统计一组证据的标签分布（纯函数） */
export function summarizeEvidence(evidence: Evidence[]): EvidenceStats {
  const stats: EvidenceStats = { verified: 0, inferred: 0, missing: 0 };
  for (const e of evidence) stats[e.label] += 1;
  return stats;
}

/** 证据总数（W3 总览条用） */
export function evidenceTotal(stats: EvidenceStats): number {
  return stats.verified + stats.inferred + stats.missing;
}

/**
 * 可追溯占比（0-100，四舍五入）。
 * 「可追溯」= 已核实：其来源能被本次输入机械核验（见 W1 的不变量）。
 * 无证据时返回 0，不做除零。
 */
export function traceablePercent(stats: EvidenceStats): number {
  const total = evidenceTotal(stats);
  return total === 0 ? 0 : Math.round((stats.verified / total) * 100);
}
