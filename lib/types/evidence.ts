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
