/**
 * 质量门禁 eval —— 评分维度（rubric）。
 *
 * 背景（W9）：W1–W4 建立的可信度层与编队改动，缺乏「改动是否让报告更好」的度量。
 * 本模块定义 judge 的评分维度与加权聚合，是 eval 的单一事实来源。
 *
 * 纪律：judge 是**代理指标、有噪音**，rubric 与权重需人工校准；
 * 分数只用于「同一 rubric 下的相对比较」，不得当真理。
 */

export interface RubricDimension {
  /** 维度 id（judge 输出 JSON 的键） */
  id: string;
  /** 展示名 */
  name: string;
  /** 判据说明（供 judge prompt 与文档使用） */
  description: string;
  /** 权重（正数；聚合时按实际参与维度归一化） */
  weight: number;
}

export const RUBRIC: RubricDimension[] = [
  {
    id: "coverage",
    name: "框架覆盖度",
    description:
      "是否覆盖该产品应有的关键分析维度（市场/用户/商业/风险/落地等），有无明显缺失或敷衍的段落。",
    weight: 0.25,
  },
  {
    id: "evidence",
    name: "证据可追溯性",
    description:
      "关键结论是否标注来源、或明确标注为推测；有无凭空捏造的市场规模、用户数等数据。",
    weight: 0.25,
  },
  {
    id: "insight",
    name: "洞察深度",
    description:
      "是否给出非显而易见、能指导决策的判断，而非对输入的泛泛复述或常识堆砌。",
    weight: 0.3,
  },
  {
    id: "actionability",
    name: "可执行性",
    description:
      "结论是否收敛为具体、可落地的下一步动作或产品决策，而非停留在描述层。",
    weight: 0.2,
  },
];

/** 维度 id → 分数（0-100） */
export type DimensionScores = Record<string, number>;

/**
 * 加权总分（0-100，四舍五入）。
 *
 * 只对「实际给出有效评分」的维度加权，权重按参与维度重新归一化 ——
 * 这样 judge 漏评某一维度时，总分不会被错误地按缺失维度计 0 而拉低。
 * 分数先夹取到 [0,100]，避免 judge 越界（如 120）污染聚合。
 * 没有任何有效维度时返回 0。
 */
export function overallScore(
  scores: DimensionScores,
  rubric: RubricDimension[] = RUBRIC,
): number {
  let weighted = 0;
  let weightSum = 0;
  for (const dim of rubric) {
    const value = scores[dim.id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const clamped = Math.min(100, Math.max(0, value));
    weighted += clamped * dim.weight;
    weightSum += dim.weight;
  }
  if (weightSum === 0) return 0;
  return Math.round(weighted / weightSum);
}
