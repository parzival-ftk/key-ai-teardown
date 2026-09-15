import type { Point, Rect } from "./viewport";

/**
 * 画布图层模型与纯操作（W29）。
 *
 * 与 `lib/orchestration/dag-layout` 同一条纪律：**布局与几何全是纯函数**，
 * 组件只负责把结果放上屏 —— 不需要 DOM 测量，也不需要在 effect 里 setState。
 *
 * 所有操作都返回新数组/新对象（不可变），便于 React 层用引用比较判断重渲染。
 */

export type CanvasNodeType = "image" | "prompt" | "component" | "frame";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 层级：越大越靠上 */
  zIndex: number;
  /** 展示名（图层面板用） */
  label?: string;
  /** image 节点的图片来源（data URL / http URL） */
  src?: string;
  /** prompt 节点的提示词文本 */
  text?: string;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** 节点最小边长（防止拉成负尺寸） */
export const MIN_NODE_SIZE = 24;

export const NODE_TYPE_LABEL: Record<CanvasNodeType, string> = {
  image: "图片",
  prompt: "Prompt",
  component: "组件",
  frame: "画框",
};

/* ── 创建与查询 ── */

export function nextZIndex(nodes: CanvasNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.zIndex), 0) + 1;
}

export interface CreateNodeInput {
  type: CanvasNodeType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
  src?: string;
  text?: string;
  /** 缺省 id（测试与受控场景可注入，保证确定性） */
  id?: string;
}

/** 新建节点：id 与 zIndex 自动分配（zIndex 置顶） */
export function createCanvasNode(
  input: CreateNodeInput,
  existing: CanvasNode[] = [],
): CanvasNode {
  const taken = new Set(existing.map((node) => node.id));
  let index = existing.length + 1;
  let id = input.id ?? `${input.type}-${index}`;
  while (taken.has(id)) {
    index += 1;
    id = input.id ? `${input.id}-${index}` : `${input.type}-${index}`;
  }
  return {
    id,
    type: input.type,
    x: input.x,
    y: input.y,
    width: input.width ?? 200,
    height: input.height ?? 140,
    zIndex: nextZIndex(existing),
    ...(input.label ? { label: input.label } : {}),
    ...(input.src ? { src: input.src } : {}),
    ...(input.text ? { text: input.text } : {}),
  };
}

/** 绘制顺序（zIndex 升序；同层保持原顺序稳定） */
export function sortByZ(nodes: CanvasNode[]): CanvasNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) =>
      a.node.zIndex === b.node.zIndex
        ? a.index - b.index
        : a.node.zIndex - b.node.zIndex,
    )
    .map((entry) => entry.node);
}

export function rectOf(node: CanvasNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** 命中测试：返回最上层（zIndex 最大）的节点 */
export function hitTest(nodes: CanvasNode[], point: Point): CanvasNode | null {
  let hit: CanvasNode | null = null;
  for (const node of nodes) {
    if (!rectContainsPoint(rectOf(node), point)) continue;
    if (!hit || node.zIndex >= hit.zIndex) hit = node;
  }
  return hit;
}

/** 框选：与矩形**相交**的节点（Figma 语义） */
export function nodesInRect(nodes: CanvasNode[], rect: Rect): CanvasNode[] {
  return nodes.filter((node) => rectsIntersect(rectOf(node), rect));
}

/** 一组节点的包围盒；空集合返回 null */
export function boundsOf(nodes: CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 由拖拽的两点生成规范化矩形（支持反向拖） */
export function normalizeRect(anchor: Point, current: Point): Rect {
  return {
    x: Math.min(anchor.x, current.x),
    y: Math.min(anchor.y, current.y),
    width: Math.abs(current.x - anchor.x),
    height: Math.abs(current.y - anchor.y),
  };
}

/* ── 变更 ── */

export function updateNode(
  nodes: CanvasNode[],
  id: string,
  patch: Partial<Omit<CanvasNode, "id" | "type">>,
): CanvasNode[] {
  return nodes.map((node) => (node.id === id ? { ...node, ...patch } : node));
}

export function updateNodes(
  nodes: CanvasNode[],
  ids: readonly string[],
  patch: (node: CanvasNode) => Partial<Omit<CanvasNode, "id" | "type">>,
): CanvasNode[] {
  const target = new Set(ids);
  return nodes.map((node) => (target.has(node.id) ? { ...node, ...patch(node) } : node));
}

export function moveNodes(
  nodes: CanvasNode[],
  ids: readonly string[],
  dx: number,
  dy: number,
): CanvasNode[] {
  return updateNodes(nodes, ids, (node) => ({ x: node.x + dx, y: node.y + dy }));
}

/**
 * 按手柄拉伸：**对侧边固定**（west 变宽时 x 同步左移），并夹取最小边长。
 */
export function resizeNode(
  node: CanvasNode,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): CanvasNode {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");

  let { x, y, width, height } = node;

  if (east) width = Math.max(MIN_NODE_SIZE, width + dx);
  if (west) {
    const next = Math.max(MIN_NODE_SIZE, width - dx);
    x += width - next;
    width = next;
  }
  if (south) height = Math.max(MIN_NODE_SIZE, height + dy);
  if (north) {
    const next = Math.max(MIN_NODE_SIZE, height - dy);
    y += height - next;
    height = next;
  }
  return { ...node, x, y, width, height };
}

export function removeNodes(nodes: CanvasNode[], ids: readonly string[]): CanvasNode[] {
  const target = new Set(ids);
  return nodes.filter((node) => !target.has(node.id));
}

/** 置顶（zIndex 提到最大） */
export function bringToFront(nodes: CanvasNode[], id: string): CanvasNode[] {
  const top = nextZIndex(nodes);
  return updateNode(nodes, id, { zIndex: top });
}

/** 置底（zIndex 压到最小；其余节点不动，用负值避免整体重排） */
export function sendToBack(nodes: CanvasNode[], id: string): CanvasNode[] {
  const bottom = nodes.reduce(
    (min, node) => Math.min(min, node.zIndex),
    Number.POSITIVE_INFINITY,
  );
  const target = Number.isFinite(bottom) ? bottom - 1 : 0;
  return updateNode(nodes, id, { zIndex: target });
}
