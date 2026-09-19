"use client";

import type { CanvasNode } from "@/lib/canvas/canvas-node";
import { canvasToScreen, type Viewport } from "@/lib/canvas/viewport";
import type { ComponentTree } from "@/lib/components/types";
import { componentEdges } from "@/lib/components/tree-to-canvas";

/**
 * 父子连线叠加层（阶段 15，spec §5「Parent / Child Relation」）。
 *
 * 结构（父子关系）取自组件树，几何（实时坐标）取自画布节点 —— 这样拖动时
 * 连线跟着走，而不是读可能滞后的树矩形。渲染进 CanvasViewport 的 `renderOverlay`。
 */

export interface ConnectionOverlayProps {
  tree: ComponentTree;
  nodes: readonly CanvasNode[];
  viewport: Viewport;
}

export function ConnectionOverlay({ tree, nodes, viewport }: ConnectionOverlayProps) {
  const rects = new Map(nodes.map((node) => [node.id, node]));
  const lines = componentEdges(tree).flatMap((edge) => {
    const parent = rects.get(edge.parentId);
    const child = rects.get(edge.childId);
    if (!parent || !child) return [];
    const from = canvasToScreen(viewport, {
      x: parent.x + parent.width / 2,
      y: parent.y + parent.height,
    });
    const to = canvasToScreen(viewport, {
      x: child.x + child.width / 2,
      y: child.y,
    });
    return [{ key: `${edge.parentId}->${edge.childId}`, from, to }];
  });

  return (
    <svg
      data-component-connections
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      {lines.map((line) => (
        <line
          key={line.key}
          data-connection={line.key}
          x1={line.from.x}
          y1={line.from.y}
          x2={line.to.x}
          y2={line.to.y}
          stroke="rgba(99,102,241,0.55)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ))}
    </svg>
  );
}
