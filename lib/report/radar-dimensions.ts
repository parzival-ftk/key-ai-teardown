/**
 * 竞品雷达图的维度定义（W16）——**单一事实来源**。
 *
 * 提示词（要求模型按这些 id 打分）与 UI（雷达图轴标签）共用同一份定义，
 * 避免「模型打的键」与「图上画的轴」对不上。
 */

export interface RadarDimension {
  id: string;
  /** 轴标签（中文） */
  label: string;
  /** 判据说明（进提示词） */
  description: string;
}

export const RADAR_DIMENSIONS: RadarDimension[] = [
  {
    id: "ux",
    label: "UI / UX",
    description: "界面与交互的成熟度、易用性、信息架构清晰度",
  },
  {
    id: "monetization",
    label: "商业化潜力",
    description: "变现路径的清晰度与可持续性（订阅 / 席位 / 广告 / 交易抽成）",
  },
  {
    id: "tech_barrier",
    label: "技术门槛",
    description: "复刻难度与技术护城河（数据模型、实时协同、算法等）",
  },
  {
    id: "jtbd_fit",
    label: "JTBD 匹配度",
    description: "对目标用户核心任务（functional / emotional / social）的满足程度",
  },
  {
    id: "growth",
    label: "增长动能",
    description: "获客与传播机制（PLG / 内容生态 / 渠道）的强弱",
  },
  {
    id: "risk",
    label: "抗风险能力",
    description: "面对竞争、合规、平台依赖等风险时的韧性",
  },
];

export const RADAR_DIMENSION_IDS: string[] = RADAR_DIMENSIONS.map((d) => d.id);

/** 维度 id → 展示名（图上找不到就回退到 id，不隐藏数据） */
export const RADAR_LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  RADAR_DIMENSIONS.map((d) => [d.id, d.label]),
);

/**
 * 清洗模型给出的维度分：
 * - 只保留已知维度（忽略臆造的键）
 * - 夹取到 0-100（越界值不放大图形）
 * - 非有限值丢弃
 * 返回的键序与 RADAR_DIMENSIONS 一致，便于直接喂给雷达图。
 */
export function normalizeDimensionScores(
  raw: Record<string, unknown> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const dim of RADAR_DIMENSIONS) {
    const value = raw[dim.id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out[dim.id] = Math.min(100, Math.max(0, Math.round(value)));
  }
  return out;
}

/** 一组维度分是否足以画图（至少 3 个轴才有雷达的意义） */
export function hasEnoughDimensions(scores: Record<string, number>): boolean {
  return Object.keys(scores).length >= 3;
}
