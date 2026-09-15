"use client";

import { RADAR_DIMENSIONS } from "@/lib/report/radar-dimensions";
import { calculateWeightedScores } from "@/lib/compare/weighted-score";

/**
 * 动态综合排名表（W20）。
 *
 * 「全指标」版对比表：每行一个竞品，列出全部维度分 + 加权综合分 + 分值变化 Δ + 名次变化。
 * 数值全部来自 `lib/compare/weighted-score`（与雷达图共用同一套加权口径），
 * 本组件只做呈现 —— 不在 UI 里二次计算，避免口径分裂。
 */

export interface WeightedRankingItem {
  id: string;
  label: string;
  scores: Record<string, number>;
}

export interface WeightedRankingTableProps {
  items: WeightedRankingItem[];
  weights?: Record<string, number>;
  dimensions?: Array<{ id: string; label: string }>;
}

const CELL = "whitespace-nowrap px-2 py-1.5 text-xs";

function DeltaBadge({ delta }: { delta: number }) {
  const sign = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const tone =
    sign === "up"
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      : sign === "down"
        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
  return (
    <span
      data-delta-badge
      data-delta-sign={sign}
      className={`rounded px-1.5 py-0.5 font-mono ${tone}`}
    >
      {sign === "flat" ? "±0" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
    </span>
  );
}

function RankDeltaBadge({ rankDelta, baseRank, rank }: { rankDelta: number; baseRank: number; rank: number }) {
  const sign = rankDelta > 0 ? "up" : rankDelta < 0 ? "down" : "flat";
  const tone =
    sign === "up"
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      : sign === "down"
        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
  return (
    <span
      data-rank-delta-badge
      data-rank-delta-sign={sign}
      title={`等权基准名次 ${baseRank} → 加权名次 ${rank}`}
      className={`rounded px-1.5 py-0.5 font-mono ${tone}`}
    >
      {sign === "flat" ? "—" : `${rankDelta > 0 ? "▲" : "▼"}${Math.abs(rankDelta)}`}
    </span>
  );
}

export function WeightedRankingTable({
  items,
  weights,
  dimensions = RADAR_DIMENSIONS,
}: WeightedRankingTableProps) {
  const result = calculateWeightedScores(
    items,
    weights,
    dimensions.map((d) => d.id),
  );

  return (
    <section
      data-weighted-ranking-section
      className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">动态综合排名</h2>
        <span className="text-[11px] text-gray-400">
          加权综合分 = Σ(维度分 × 权重) ÷ Σ(权重)，与雷达图同一套口径
        </span>
      </div>

      {result.fallback && (
        <p
          data-ranking-fallback
          className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {result.diagnostics.join(" ")}
        </p>
      )}

      <div className="overflow-x-auto">
        <table data-weighted-ranking className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-200 text-[11px] text-gray-500 dark:border-gray-800">
              <th className={CELL}>#</th>
              <th className={CELL}>竞品</th>
              {dimensions.map((dim) => (
                <th key={dim.id} data-ranking-head={dim.id} className={CELL}>
                  {dim.label}
                  <span className="ml-1 font-mono text-blue-600 dark:text-blue-400">
                    ×{result.effectiveWeights[dim.id]}
                  </span>
                </th>
              ))}
              <th className={CELL}>加权综合分</th>
              <th className={CELL}>Δ</th>
              <th className={CELL}>名次变化</th>
            </tr>
          </thead>
          <tbody>
            {result.scores.map((score) => {
              const item = items.find((i) => i.id === score.id);
              return (
                <tr
                  key={score.id}
                  data-ranking-row={score.id}
                  data-ranking-rank={score.rank}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-900"
                >
                  <td className={`${CELL} font-mono text-gray-500`}>{score.rank}</td>
                  <td className={`${CELL} font-medium`}>{score.label}</td>
                  {dimensions.map((dim) => (
                    <td
                      key={dim.id}
                      data-ranking-cell={`${score.id}:${dim.id}`}
                      className={`${CELL} font-mono text-gray-600 dark:text-gray-300`}
                    >
                      {item?.scores?.[dim.id] ?? 0}
                    </td>
                  ))}
                  <td
                    data-ranking-weighted={score.id}
                    className={`${CELL} font-mono font-semibold`}
                  >
                    {score.weighted.toFixed(1)}
                  </td>
                  <td className={CELL}>
                    <DeltaBadge delta={score.delta} />
                  </td>
                  <td className={CELL}>
                    <RankDeltaBadge
                      rankDelta={score.rankDelta}
                      baseRank={score.baseRank}
                      rank={score.rank}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {result.scores.length === 0 && (
        <p className="text-xs text-gray-400">尚无可比较的维度打分。</p>
      )}
    </section>
  );
}
