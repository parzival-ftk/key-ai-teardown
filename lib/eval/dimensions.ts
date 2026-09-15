/**
 * 评估维度（W14 · Eval 2.0）—— **单一事实来源**。
 *
 * 离线 eval 管线（eval/rubric.ts 转发）与在线质量看板（components/eval/QualityBoard）共用这一份定义，
 * 避免「两处各写一套维度」的漂移。
 *
 * 维度选择对齐本产品的四个卖点：
 * - Consistency 逻辑自洽性 ← 辩论/裁决链是否闭合
 * - JTBD Relevance   ← 用户研究员的画像与三层 job 是否到位
 * - Traceability     ← 证据标签 + 「已核实必须可追溯」这条不变量（本项目核心差异化，权重最高）
 * - PRD Completeness ← PRD 撰写官的可落地性
 */

export type EvaluationDimensionId =
  | "consistency"
  | "jtbd"
  | "traceability"
  | "prd";

export interface EvaluationDimension {
  id: EvaluationDimensionId;
  /** 中文展示名 */
  name: string;
  /** 英文名（与需求规格一致，便于对外沟通） */
  nameEn: string;
  /** 判据说明（供 judge prompt、看板 tooltip 与文档使用） */
  description: string;
  /** 权重（正数；聚合时按实际参与维度归一化） */
  weight: number;
}

export const EVAL_DIMENSIONS: EvaluationDimension[] = [
  {
    id: "consistency",
    name: "逻辑自洽性",
    nameEn: "Consistency",
    description:
      "辩论链是否闭合：质疑 → 答辩 → 裁决三段齐全，综合结论给出分歧裁决而非并列复述；段落覆盖完整。",
    weight: 0.25,
  },
  {
    id: "jtbd",
    name: "JTBD 匹配度",
    nameEn: "JTBD Relevance",
    description:
      "用户画像是否按行为聚类、是否给出 functional / emotional / social 三层 job，访谈是否落在同一套画像并暴露摩擦点。",
    weight: 0.25,
  },
  {
    id: "traceability",
    name: "证据追溯度",
    nameEn: "Traceability",
    description:
      "关键结论是否带证据标签；「已核实」是否真的可追溯（有来源）—— 无来源的「已核实」按伪造引用重罚。",
    weight: 0.3,
  },
  {
    id: "prd",
    name: "PRD 可落地性",
    nameEn: "PRD Completeness",
    description:
      "PRD 是否包含用户故事、验收标准、成功指标、功能范围与发布就绪清单 —— 缺一项即扣分。",
    weight: 0.2,
  },
];

/** 门禁阈值（综合分 ≥ 该值视为通过） */
export const DEFAULT_GATE_THRESHOLD = 80;

/**
 * 加权综合分（0-100，四舍五入）。
 * 只对「实际给出有效评分」的维度加权并重新归一化 —— 缺评维度不会被当作 0 拉低总分。
 * 分数先夹取到 [0,100]；无任何有效维度时返回 0。
 */
export function compositeScore(
  scores: Record<string, number>,
  dimensions: EvaluationDimension[] = EVAL_DIMENSIONS,
): number {
  let weighted = 0;
  let weightSum = 0;
  for (const dim of dimensions) {
    const value = scores[dim.id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const clamped = Math.min(100, Math.max(0, value));
    weighted += clamped * dim.weight;
    weightSum += dim.weight;
  }
  if (weightSum === 0) return 0;
  return Math.round(weighted / weightSum);
}
