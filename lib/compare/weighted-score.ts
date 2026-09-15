import { RADAR_DIMENSION_IDS } from "@/lib/report/radar-dimensions";

/**
 * W20 · 全指标动态加权与排名重算引擎（纯函数）。
 *
 * 口径：加权综合分 = Σ(维度分 × 权重) / Σ(权重) —— 仍是 **0–100 的可比口径**，
 * 不会因为权重整体变大而膨胀。权重为 0 的维度同时从分子与分母中消失（等价于「忽略该维度」）。
 *
 * 边界安全（本模块的硬约束）：全 0 权重、NaN / Infinity / 负数权重一律**整体降级为等权**
 * 并给出诊断，绝不产出 NaN 或除零；越界权重夹取到上限而非降级（那仍是有效意图）。
 *
 * 排名按**四舍五入后的分数**比较 —— 排的必须是用户看到的那两个数，否则会出现
 * 「显示同分但名次不同」的矛盾。
 */

/** 默认权重倍率（未配置时每个维度等权） */
export const DEFAULT_WEIGHT = 1;
/** 权重上限（越界夹取，防止单个维度吞掉全部权重） */
export const MAX_WEIGHT = 10;

/** 参与加权的一个竞品及其各维度分（维度 id → 0–100） */
export interface DimensionScore {
  id: string;
  /** 展示名；缺省回退为 id */
  label?: string;
  scores: Record<string, number>;
}

export interface WeightedScore {
  id: string;
  label: string;
  /** 加权综合分（0–100） */
  weighted: number;
  /** 等权基准综合分（0–100） */
  baseline: number;
  /** weighted − baseline（正 = 加权后更占优） */
  delta: number;
  /** 加权后的名次（1 起，同分并列） */
  rank: number;
  /** 等权基准下的名次 */
  baseRank: number;
  /** 名次变化：正 = 上升几名 */
  rankDelta: number;
}

export interface WeightedResult {
  /** 按名次升序（同分按 id 稳定排序） */
  scores: WeightedScore[];
  /** 是否因非法/全 0 权重降级为等权 */
  fallback: boolean;
  /** 实际生效的权重（覆盖全部生效维度） */
  effectiveWeights: Record<string, number>;
  /** 降级与夹取原因（正常时为空） */
  diagnostics: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 维度分 → 0–100；非数字 / 非有限值按 0（与雷达图的归一化口径一致） */
function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

interface ResolvedWeights {
  weights: Record<string, number>;
  fallback: boolean;
  diagnostics: string[];
}

/** 权重规范化：补默认、夹上限、非法或全 0 时整体降级 */
function resolveWeights(
  ids: string[],
  raw: Record<string, number> | undefined,
): ResolvedWeights {
  const diagnostics: string[] = [];
  const weights: Record<string, number> = {};

  if (raw) {
    for (const key of Object.keys(raw)) {
      if (!ids.includes(key)) {
        diagnostics.push(`未知维度 "${key}" 的权重已忽略。`);
      }
    }
  }

  const invalid: string[] = [];
  for (const id of ids) {
    const value = raw?.[id];
    if (value === undefined) {
      weights[id] = DEFAULT_WEIGHT;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      invalid.push(id);
      weights[id] = DEFAULT_WEIGHT;
      continue;
    }
    if (value > MAX_WEIGHT) {
      weights[id] = MAX_WEIGHT;
      diagnostics.push(
        `维度 "${id}" 的权重 ${value} 超出上限，已夹取为 ${MAX_WEIGHT}。`,
      );
      continue;
    }
    weights[id] = value;
  }

  let fallback = false;

  if (invalid.length > 0) {
    fallback = true;
    diagnostics.push(
      `存在非法权重（${invalid.join("、")}），已整体降级为等权计算。`,
    );
    for (const id of ids) weights[id] = DEFAULT_WEIGHT;
  }

  const total = ids.reduce((sum, id) => sum + weights[id], 0);
  if (ids.length > 0 && total === 0) {
    fallback = true;
    diagnostics.push("所有维度权重均为 0，无法加权，已降级为等权计算。");
    for (const id of ids) weights[id] = DEFAULT_WEIGHT;
  }

  return { weights, fallback, diagnostics };
}

/** 名次分配：按分数降序（同分按 id 升序保证确定性），同分并列且后续名次跳过 */
function assignRanks(items: Array<{ id: string; value: number }>): Map<string, number> {
  const sorted = [...items].sort(
    (a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const ranks = new Map<string, number>();
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach((item, index) => {
    if (lastValue !== null && item.value === lastValue) {
      ranks.set(item.id, lastRank);
      return;
    }
    lastRank = index + 1;
    lastValue = item.value;
    ranks.set(item.id, lastRank);
  });
  return ranks;
}

/**
 * 计算加权综合分、Δ 与重排后的名次。
 *
 * @param dimensions  参与对比的竞品（各自的维度分）
 * @param weights     维度 id → 权重倍率；缺省为等权
 * @param dimensionIds 生效维度集合，缺省取雷达图的 6 个维度（单一事实来源）
 */
export function calculateWeightedScores(
  dimensions: DimensionScore[],
  weights: Record<string, number> = {},
  dimensionIds: string[] = RADAR_DIMENSION_IDS,
): WeightedResult {
  const ids = dimensionIds ?? [];
  const { weights: effectiveWeights, fallback, diagnostics } = resolveWeights(
    ids,
    weights,
  );

  const total = ids.reduce((sum, id) => sum + effectiveWeights[id], 0);
  const sumOf = (scores: Record<string, number>, useWeights: boolean) =>
    ids.reduce(
      (acc, id) => acc + clampScore(scores?.[id]) * (useWeights ? effectiveWeights[id] : 1),
      0,
    );

  const baseDenominator = ids.length;

  const computed = dimensions.map((d) => ({
    id: d.id,
    label: d.label ?? d.id,
    weighted: round1(total > 0 ? sumOf(d.scores, true) / total : 0),
    baseline: round1(baseDenominator > 0 ? sumOf(d.scores, false) / baseDenominator : 0),
  }));

  const rankById = assignRanks(computed.map((c) => ({ id: c.id, value: c.weighted })));
  const baseRankById = assignRanks(
    computed.map((c) => ({ id: c.id, value: c.baseline })),
  );

  const scores: WeightedScore[] = computed
    .map((c) => {
      const rank = rankById.get(c.id) ?? computed.length;
      const baseRank = baseRankById.get(c.id) ?? computed.length;
      return {
        id: c.id,
        label: c.label,
        weighted: c.weighted,
        baseline: c.baseline,
        delta: round1(c.weighted - c.baseline),
        rank,
        baseRank,
        rankDelta: baseRank - rank,
      };
    })
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { scores, fallback, effectiveWeights, diagnostics };
}
