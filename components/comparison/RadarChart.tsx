"use client";

import { useState } from "react";
import { RADAR_DIMENSIONS } from "@/lib/report/radar-dimensions";
import { DEFAULT_WEIGHT } from "@/lib/compare/weighted-score";

/**
 * 竞品雷达图（W16，W20 加动态加权）。
 *
 * **零依赖**，纯 SVG `<polygon>` / `<line>` 自绘。
 * 不引图表库的理由与本项目其它渲染能力一致：需求就是「多边形 + 轴 + 图例」，
 * 自研可控、体积极小、且几何计算能纯函数单测。
 *
 * 交互：2-3 个竞品颜色区分 + 半透明重叠；hover 单个竞品高亮（其余淡出）；Legend 点击切换显隐。
 *
 * W20 加权：传入 `weights` 后按权重缩放**对应轴的半径**（轴线端点、网格顶点、数据顶点同步缩放）。
 * 注意这只是**几何示意** —— 顶点半径 = 分/100 × 半径 × 轴权重倍率，图形面积并不等于加权综合分；
 * 真正的加权口径见 `lib/compare/weighted-score`（表格里的「加权综合分」才是权威）。
 */

export interface RadarSeries {
  id: string;
  label: string;
  /** 描边色（fill 用同色 + 低透明度） */
  color: string;
  /** 维度 id → 0-100 */
  scores: Record<string, number>;
}

export interface RadarChartProps {
  series: RadarSeries[];
  /** 维度轴（默认取 lib/report/radar-dimensions 的 6 维） */
  dimensions?: Array<{ id: string; label: string }>;
  /** 画布边长（px） */
  size?: number;
  /** 初始隐藏的竞品 id */
  defaultHidden?: string[];
  /** W20：维度 id → 权重倍率（缺省 / 全 0 时按等权处理，图形与不加权完全一致） */
  weights?: Record<string, number>;
}

export const RADAR_GRID_LEVELS = [0.25, 0.5, 0.75, 1];

/**
 * 权重 → 各轴的长度倍率：最强维度取满半径，其余按比例（保持图形不溢出画布）。
 * 缺省维度按 `DEFAULT_WEIGHT` 补齐；权重全 0 或非法时退回全 1（与加权引擎的降级口径一致）。
 */
export function axisScalesFor(
  dimensions: Array<{ id: string }>,
  weights?: Record<string, number>,
): number[] {
  const raw = dimensions.map((dim) => {
    const w = weights?.[dim.id];
    return typeof w === "number" && Number.isFinite(w) && w >= 0
      ? w
      : DEFAULT_WEIGHT;
  });
  const max = raw.length > 0 ? Math.max(...raw) : 0;
  if (!(max > 0)) return dimensions.map(() => 1);
  return raw.map((w) => w / max);
}

/** 第 index 条轴的角度（从正上方起，顺时针均分） */
export function axisAngle(index: number, count: number): number {
  return (Math.PI * 2 * index) / count - Math.PI / 2;
}

/** 极坐标 → 直角坐标 */
export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  index: number,
  count: number,
): { x: number; y: number } {
  const angle = axisAngle(index, count);
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/**
 * 一组 0-100 的值 → SVG polygon 的 points 串。
 * `axisScales` 给出各轴的长度倍率（W20 加权）；缺省即不加权。
 */
export function polygonPoints(
  values: number[],
  cx: number,
  cy: number,
  radius: number,
  axisScales?: number[],
): string {
  const count = values.length;
  return values
    .map((value, index) => {
      const ratio = Math.min(100, Math.max(0, value)) / 100;
      const scale = axisScales?.[index] ?? 1;
      const p = polarPoint(cx, cy, radius * ratio * scale, index, count);
      return `${round(p.x)},${round(p.y)}`;
    })
    .join(" ");
}

const round = (n: number) => Math.round(n * 100) / 100;

/** 坐标取整后的文本锚点，避免标签压住图形 */
function labelAnchor(x: number, cx: number): "start" | "middle" | "end" {
  if (Math.abs(x - cx) < 6) return "middle";
  return x > cx ? "start" : "end";
}

export function RadarChart({
  series,
  dimensions = RADAR_DIMENSIONS,
  size = 320,
  defaultHidden = [],
  weights,
}: RadarChartProps) {
  const [hidden, setHidden] = useState<string[]>(defaultHidden);
  const [active, setActive] = useState<string | null>(null);

  const count = dimensions.length;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 58;
  const visible = series.filter((s) => !hidden.includes(s.id));

  // W20：各轴长度倍率。等权时全为 1，图形与不加权**完全一致**（不引入视觉漂移）。
  const axisScales = axisScalesFor(dimensions, weights);
  const weighted = axisScales.some((s) => s !== 1);
  const weightOf = (id: string) => {
    const w = weights?.[id];
    return typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : DEFAULT_WEIGHT;
  };

  const toggle = (id: string) =>
    setHidden((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <section
      data-radar
      data-radar-series-count={series.length}
      data-radar-visible-count={visible.length}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height={size}
        role="img"
        aria-label={`竞品雷达图（${visible.length} 个竞品 / ${count} 个维度）`}
        data-radar-svg
      >
        {/* 底盘：同心多边形网格（随权重变形，使「被加权放大的轴」肉眼可辨） */}
        {RADAR_GRID_LEVELS.map((level) => (
          <polygon
            key={level}
            data-radar-grid={level}
            points={polygonPoints(
              Array.from({ length: count }, () => level * 100),
              cx,
              cy,
              radius,
              axisScales,
            )}
            className="fill-none stroke-gray-200 dark:stroke-gray-800"
            strokeWidth={1}
          />
        ))}

        {/* 轴线 + 轴标签（轴线长度即该维度的权重倍率） */}
        {dimensions.map((dim, index) => {
          const scale = axisScales[index] ?? 1;
          const weight = weightOf(dim.id);
          const outer = polarPoint(cx, cy, radius * scale, index, count);
          const label = polarPoint(cx, cy, radius * scale + 18, index, count);
          return (
            <g
              key={dim.id}
              data-radar-dimension={dim.id}
              data-radar-axis-weight={weight}
              data-radar-axis-scale={round(scale)}
            >
              <line
                x1={cx}
                y1={cy}
                x2={outer.x}
                y2={outer.y}
                className="stroke-gray-200 dark:stroke-gray-800"
                strokeWidth={1}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={labelAnchor(label.x, cx)}
                dominantBaseline="middle"
                className="fill-gray-500 text-[10px] dark:fill-gray-400"
              >
                {dim.label}
                {weight !== DEFAULT_WEIGHT && (
                  <tspan
                    data-radar-axis-multiplier
                    className="fill-blue-600 dark:fill-blue-400"
                  >
                    {` ×${weight}`}
                  </tspan>
                )}
              </text>
            </g>
          );
        })}

        {/* 竞品多边形：半透明重叠，hover 高亮 */}
        {visible.map((s) => {
          const isActive = active === s.id;
          const dimmed = active !== null && !isActive;
          const values = dimensions.map((d) => s.scores[d.id] ?? 0);
          return (
            <g
              key={s.id}
              data-radar-polygon={s.id}
              data-radar-active={isActive ? "true" : "false"}
              onMouseEnter={() => setActive(s.id)}
              onMouseLeave={() => setActive(null)}
            >
              <polygon
                points={polygonPoints(values, cx, cy, radius, axisScales)}
                fill={s.color}
                stroke={s.color}
                fillOpacity={dimmed ? 0.04 : isActive ? 0.28 : 0.16}
                strokeOpacity={dimmed ? 0.35 : 1}
                strokeWidth={isActive ? 3 : 2}
                strokeLinejoin="round"
              />
              {/* 顶点圆点：命中区域更大，hover 更稳 */}
              {values.map((value, index) => {
                const p = polarPoint(
                  cx,
                  cy,
                  ((radius * Math.min(100, Math.max(0, value))) / 100) *
                    (axisScales[index] ?? 1),
                  index,
                  count,
                );
                return (
                  <circle
                    key={dimensions[index].id}
                    cx={p.x}
                    cy={p.y}
                    r={isActive ? 4 : 2.5}
                    fill={s.color}
                    fillOpacity={dimmed ? 0.35 : 1}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-1.5" data-radar-legend>
        {series.map((s) => {
          const isHidden = hidden.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              data-radar-legend-item={s.id}
              data-radar-hidden={isHidden ? "true" : "false"}
              aria-pressed={!isHidden}
              onClick={() => toggle(s.id)}
              onMouseEnter={() => setActive(s.id)}
              onMouseLeave={() => setActive(null)}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition ${
                isHidden
                  ? "border-gray-200 text-gray-400 dark:border-gray-800"
                  : "border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-200"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: isHidden ? "currentColor" : s.color }}
              />
              <span className={isHidden ? "line-through" : ""}>{s.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400">
        点击图例可显隐；悬停某个竞品会高亮该多边形并淡出其它。分数为模型自评（0-100），
        非客观测量 —— 只用于同类横向对比。
      </p>
      {weighted && (
        <p data-radar-weight-note className="text-[11px] text-blue-600 dark:text-blue-400">
          轴线长度已按维度权重缩放（几何示意）；加权后的真实综合分与排名见下方表格。
        </p>
      )}
    </section>
  );
}
