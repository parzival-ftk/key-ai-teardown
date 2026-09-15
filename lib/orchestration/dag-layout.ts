import type { DagConfig } from "./dagConfig";

/**
 * DAG 布局数学（W13，纯函数）。
 *
 * 关键决策：**用确定性坐标而非 DOM 测量**。
 * 若靠 getBoundingClientRect 量位置再画连线，就得在 effect 里 setState（本轮刚清除的
 * `react-hooks/set-state-in-effect` 会立刻回来），且首帧无坐标会闪。
 * 改为「列 = 层、行 = 层内序」固定步长计算，节点与 SVG 共享同一套坐标 —— 零测量、零 effect、可单测。
 */

export interface DagLayoutMetrics {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  padding: number;
}

export const DAG_LAYOUT: DagLayoutMetrics = {
  nodeWidth: 168,
  nodeHeight: 72,
  gapX: 80,
  gapY: 18,
  padding: 20,
};

export interface DagPosition {
  x: number;
  y: number;
}

export interface DagLayout {
  width: number;
  height: number;
  /** node id → 左上角坐标 */
  positions: Record<string, DagPosition>;
  metrics: DagLayoutMetrics;
}

/** 计算画布尺寸与每个节点的坐标；行方向按最长层居中，使图形对称 */
export function computeDagLayout(
  config: DagConfig,
  metrics: DagLayoutMetrics = DAG_LAYOUT,
): DagLayout {
  const rows = Math.max(1, ...config.layers.map((layer) => layer.length));
  const colStep = metrics.nodeWidth + metrics.gapX;
  const rowStep = metrics.nodeHeight + metrics.gapY;

  const positions: Record<string, DagPosition> = {};
  config.layers.forEach((layer, layerIndex) => {
    const offsetY = ((rows - layer.length) * rowStep) / 2;
    layer.forEach((id, rowIndex) => {
      positions[id] = {
        x: metrics.padding + layerIndex * colStep,
        y: metrics.padding + offsetY + rowIndex * rowStep,
      };
    });
  });

  return {
    width:
      metrics.padding * 2 + Math.max(1, config.layers.length) * colStep - metrics.gapX,
    height: metrics.padding * 2 + rows * rowStep - metrics.gapY,
    positions,
    metrics,
  };
}

/** 边的三次贝塞尔路径：源节点右中点 → 目标节点左中点 */
export function edgePath(
  from: DagPosition,
  to: DagPosition,
  metrics: DagLayoutMetrics = DAG_LAYOUT,
): string {
  const x1 = from.x + metrics.nodeWidth;
  const y1 = from.y + metrics.nodeHeight / 2;
  const x2 = to.x;
  const y2 = to.y + metrics.nodeHeight / 2;
  const dx = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
