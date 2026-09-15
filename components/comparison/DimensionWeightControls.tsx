"use client";

import { useState } from "react";
import { RADAR_DIMENSIONS } from "@/lib/report/radar-dimensions";
import { DEFAULT_WEIGHT } from "@/lib/compare/weighted-score";

/**
 * 维度权重配置面板（W20）。
 *
 * 可展开/收起：收起时只留一行摘要（默认等权 / 已调整 N 项），展开后每个维度一条滑杆，
 * 实时显示倍率（如 `1.5x`），并提供「重置为默认」。
 *
 * 面板只负责**编辑权重**，不持有计算结果 —— 加权与排名由 `lib/compare/weighted-score`
 * 统一算出，避免「控件算一套、表格算一套」的口径分裂。
 */

export interface WeightControlsDimension {
  id: string;
  label: string;
  description?: string;
}

export interface DimensionWeightControlsProps {
  /** 维度 id → 权重倍率（缺失即默认权重） */
  weights: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  /** 维度集合（默认雷达图 6 维） */
  dimensions?: WeightControlsDimension[];
  /** 滑杆上限（权重越界由加权引擎夹取，这里只是 UI 边界） */
  max?: number;
  step?: number;
  /** 初始是否展开 */
  defaultExpanded?: boolean;
}

/** 倍率文案：整数不带小数，非整数保留一位（`1x` / `1.5x`） */
export function formatWeight(weight: number): string {
  return `${Number.isInteger(weight) ? weight : weight.toFixed(1)}x`;
}

export function DimensionWeightControls({
  weights,
  onChange,
  dimensions = RADAR_DIMENSIONS,
  max = 3,
  step = 0.1,
  defaultExpanded = false,
}: DimensionWeightControlsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const weightOf = (id: string): number => {
    const w = weights[id];
    return typeof w === "number" && Number.isFinite(w) && w >= 0
      ? w
      : DEFAULT_WEIGHT;
  };

  const adjusted = dimensions.filter((d) => weightOf(d.id) !== DEFAULT_WEIGHT);
  const setWeight = (id: string, value: number) =>
    onChange({ ...weights, [id]: value });

  return (
    <section
      data-weight-controls
      data-weight-adjusted-count={adjusted.length}
      className="rounded-xl border border-gray-200 dark:border-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          data-weight-panel-toggle
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          维度权重配置
        </button>
        <span className="text-xs text-gray-400" data-weight-summary>
          {expanded
            ? "调整滑杆即时重算综合分与排名"
            : adjusted.length > 0
              ? `已调整 ${adjusted.length} 项：${adjusted.map((d) => `${d.label} ${formatWeight(weightOf(d.id))}`).join("、")}`
              : "默认等权（每个维度 ×1）"}
        </span>
        <button
          type="button"
          data-weight-action="reset"
          onClick={() => onChange({})}
          disabled={adjusted.length === 0}
          className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 transition hover:border-gray-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
        >
          重置为默认
        </button>
      </div>

      {expanded && (
        <div
          data-weight-panel
          className="flex flex-col gap-2 border-t border-gray-200 px-3 py-3 dark:border-gray-800"
        >
          {dimensions.map((dim) => {
            const value = weightOf(dim.id);
            return (
              <label
                key={dim.id}
                data-weight-row={dim.id}
                className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300"
              >
                <span className="w-24 shrink-0">{dim.label}</span>
                <input
                  type="range"
                  data-weight-slider={dim.id}
                  aria-label={`${dim.label} 权重`}
                  min={0}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) => setWeight(dim.id, Number(e.target.value))}
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-blue-600"
                />
                <span
                  data-weight-value={dim.id}
                  className={`w-10 shrink-0 text-right font-mono ${
                    value === DEFAULT_WEIGHT
                      ? "text-gray-400"
                      : "font-medium text-blue-600 dark:text-blue-400"
                  }`}
                >
                  {formatWeight(value)}
                </span>
              </label>
            );
          })}
          <p className="text-[11px] text-gray-400">
            权重只影响「加权综合分」与排名；雷达图轴线长度按权重等比缩放（几何示意）。
            权重为 0 表示该维度不参与比较。
          </p>
        </div>
      )}
    </section>
  );
}
