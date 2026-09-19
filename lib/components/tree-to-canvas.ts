import {
  createCanvasNode,
  type CanvasNode,
  type CanvasNodeType,
} from "@/lib/canvas/canvas-node";
import type { ComponentType, ComponentTree, GeneratedAsset, Rect } from "./types";
import { depthOf, flattenTree, updateComponent } from "./tree";

/**
 * 组件树 ↔ 画布节点的映射（阶段 15）。
 *
 * 这是「结构化拆解」与「无限画布」之间唯一的桥：组件树是领域模型，`CanvasNode`
 * 是画布模型，两者不互相污染。映射是纯函数，可单测。
 *
 * 层级 → 画布类型：page / section 用透明的 `frame`（父级铺底，子组件可见），
 * component / element 用不透明的 `component` 盒子。zIndex 取深度，父在子下，
 * 命中测试自然落到最具体的子组件上。
 */

export function componentCanvasType(type: ComponentType): CanvasNodeType {
  return type === "page" || type === "section" ? "frame" : "component";
}

/** 组件树 → 画布节点（每个组件一个节点，zIndex 按深度、id 即组件 id） */
export function treeToCanvasNodes(tree: ComponentTree): CanvasNode[] {
  return flattenTree(tree).map((node) => ({
    id: node.id,
    type: componentCanvasType(node.type),
    x: node.rect.x,
    y: node.rect.y,
    width: node.rect.width > 0 ? node.rect.width : 200,
    height: node.rect.height > 0 ? node.rect.height : 120,
    zIndex: depthOf(tree, node.id),
    label: node.name,
    componentId: node.id,
  }));
}

/** 生成资产在画布上的落点（放在来源组件右侧，多张按序错开） */
export function assetRect(tree: ComponentTree, componentId: string, index: number): Rect {
  const rect = tree.nodes[componentId]?.rect;
  const baseX = rect ? rect.x + rect.width + 48 : 40 + index * 40;
  const baseY = rect ? rect.y + index * 40 : 40 + index * 40;
  return { x: baseX, y: baseY, width: 320, height: 320 };
}

/** 生成资产 → 画布图片节点（绑定来源组件，追溯「这张图属于哪个组件」） */
export function assetsToCanvasNodes(
  tree: ComponentTree,
  assets: readonly GeneratedAsset[],
  existing: CanvasNode[] = [],
): CanvasNode[] {
  const nodes = [...existing];
  assets.forEach((asset, index) => {
    if (!asset.url) return;
    const rect = assetRect(tree, asset.componentId, index);
    nodes.push(
      createCanvasNode(
        {
          id: `asset-${asset.id}`,
          type: "image",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          label: asset.prompt.slice(0, 24) || "生成资产",
          src: asset.url,
          componentId: asset.componentId,
        },
        nodes,
      ),
    );
  });
  return nodes.slice(existing.length);
}

/** 画布节点回写组件树矩形（拖动 / 拉伸后保持树与画布几何一致） */
export function applyCanvasToTree(tree: ComponentTree, nodes: readonly CanvasNode[]): ComponentTree {
  let next = tree;
  for (const node of nodes) {
    if (!node.componentId || !next.nodes[node.componentId]) continue;
    const current = next.nodes[node.componentId];
    if (
      current.rect.x === node.x &&
      current.rect.y === node.y &&
      current.rect.width === node.width &&
      current.rect.height === node.height
    ) {
      continue;
    }
    next = updateComponent(next, node.componentId, {
      rect: { x: node.x, y: node.y, width: node.width, height: node.height },
    });
  }
  return next;
}

/** 父子连线（供画布叠加层绘制）：每条边给出父节点与子节点的 id */
export interface ComponentEdge {
  parentId: string;
  childId: string;
}

export function componentEdges(tree: ComponentTree): ComponentEdge[] {
  const edges: ComponentEdge[] = [];
  for (const node of Object.values(tree.nodes)) {
    for (const childId of node.children) {
      if (tree.nodes[childId]) edges.push({ parentId: node.id, childId });
    }
  }
  return edges;
}
