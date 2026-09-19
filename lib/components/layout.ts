import type { ComponentTree } from "./types";
import { depthOf, flattenTree } from "./tree";

/**
 * 组件树布局（阶段 15，纯函数）。
 *
 * 画布是无限二维空间，而 AI 分析产出的树本身不带稳定坐标。这里给出一套
 * **确定性**的整齐布局：DFS 顺序决定纵向行号，深度决定横向缩进 —— 父在上、子在下，
 * 层级一目了然。分析结果若已带真实矩形（截图里的实际位置），则原样保留
 * （`ensureRects` 只在缺矩形时才布局）。
 */

export interface LayoutOptions {
  originX: number;
  originY: number;
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  originX: 80,
  originY: 60,
  nodeWidth: 220,
  nodeHeight: 120,
  gapX: 96,
  gapY: 36,
};

/** 是否每个节点都有可用的矩形（宽高为正） */
export function hasCompleteRects(tree: ComponentTree): boolean {
  const nodes = Object.values(tree.nodes);
  if (nodes.length === 0) return false;
  return nodes.every((node) => node.rect.width > 0 && node.rect.height > 0);
}

/** 为所有节点分配整齐矩形（覆盖已有坐标） */
export function layoutTree(
  tree: ComponentTree,
  options: Partial<LayoutOptions> = {},
): ComponentTree {
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT, ...options };
  const ordered = flattenTree(tree);
  const nodes = { ...tree.nodes };
  ordered.forEach((node, row) => {
    const depth = depthOf(tree, node.id);
    nodes[node.id] = {
      ...node,
      rect: {
        x: opts.originX + depth * (opts.nodeWidth + opts.gapX),
        y: opts.originY + row * (opts.nodeHeight + opts.gapY),
        width: opts.nodeWidth,
        height: opts.nodeHeight,
      },
    };
  });
  return { ...tree, nodes };
}

/** 仅当树缺矩形时布局；已有完整矩形则原样返回 */
export function ensureRects(
  tree: ComponentTree,
  options: Partial<LayoutOptions> = {},
): ComponentTree {
  return hasCompleteRects(tree) ? tree : layoutTree(tree, options);
}
