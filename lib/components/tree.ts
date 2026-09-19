import type { ComponentNode, ComponentTree, ComponentType } from "./types";
import type { RawComponentNode } from "./schema";

/**
 * 组件树的纯操作（阶段 15）。
 *
 * 与 `lib\canvas\canvas-node` 同一条纪律：**全是纯函数**，返回新对象，
 * 便于 React 用引用比较判断重渲染，也便于在 Node 下单测（不需要 jsdom）。
 *
 * 树是扁平的（`nodes: Record<id, node>` + `rootId`），遍历类操作都做环路防护
 * —— 持久化数据被篡改或多处引用同一子节点时，遍历不得死循环。
 */

/* ── 由 AI 的嵌套 JSON 构建扁平树 ── */

/**
 * 把 AI 输出的嵌套节点归一成扁平树。
 *
 * - id 按 DFS 顺序生成（`n1`, `n2`, …），确定性、可复现；
 * - 缺 `type` 时按深度推断：根=page、二级=section、更深=component；
 * - 缺 `rect` 时置 `{x:0,y:0,width:0,height:0}`（交由 `layoutTree` 布局）。
 */
export function treeFromRaw(page: RawComponentNode): ComponentTree {
  const nodes: Record<string, ComponentNode> = {};
  let counter = 0;

  const visit = (
    raw: RawComponentNode,
    parentId: string | undefined,
    depth: number,
  ): string => {
    counter += 1;
    const id = `n${counter}`;
    const type: ComponentType =
      raw.type ?? (depth === 0 ? "page" : depth === 1 ? "section" : "component");
    const node: ComponentNode = {
      id,
      type,
      name: raw.name,
      rect: raw.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      children: [],
      ...(parentId ? { parentId } : {}),
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.properties ? { properties: raw.properties } : {}),
      ...(raw.prompt ? { prompt: raw.prompt } : {}),
    };
    nodes[id] = node;
    node.children = (raw.children ?? []).map((child) => visit(child, id, depth + 1));
    return id;
  };

  const rootId = visit(page, undefined, 0);
  return { rootId, nodes };
}

/* ── 查询 ── */

export function rootNode(tree: ComponentTree): ComponentNode | null {
  return tree.nodes[tree.rootId] ?? null;
}

export function findComponent(tree: ComponentTree, id: string): ComponentNode | null {
  return tree.nodes[id] ?? null;
}

/** 直接子节点（按 children 顺序；缺失的子 id 被跳过） */
export function childrenOf(tree: ComponentTree, id: string): ComponentNode[] {
  const node = tree.nodes[id];
  if (!node) return [];
  return node.children
    .map((childId) => tree.nodes[childId])
    .filter((child): child is ComponentNode => Boolean(child));
}

/** 后代节点（DFS，不含自身；有环路防护） */
export function descendantsOf(tree: ComponentTree, id: string): ComponentNode[] {
  const out: ComponentNode[] = [];
  const seen = new Set<string>([id]);
  const stack: string[] = [];
  const start = tree.nodes[id];
  if (!start) return out;
  for (let i = start.children.length - 1; i >= 0; i--) stack.push(start.children[i]);
  while (stack.length > 0) {
    const currentId = stack.pop() as string;
    if (seen.has(currentId)) continue;
    seen.add(currentId);
    const node = tree.nodes[currentId];
    if (!node) continue;
    out.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return out;
}

/** 全部节点（DFS，含根） */
export function flattenTree(tree: ComponentTree): ComponentNode[] {
  const root = rootNode(tree);
  if (!root) return [];
  return [root, ...descendantsOf(tree, root.id)];
}

/** 祖先链（从直接父节点到根；有环路防护） */
export function ancestorsOf(tree: ComponentTree, id: string): ComponentNode[] {
  const out: ComponentNode[] = [];
  const seen = new Set<string>([id]);
  let current = tree.nodes[id]?.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = tree.nodes[current];
    if (!node) break;
    out.push(node);
    current = node.parentId;
  }
  return out;
}

/** 深度：根为 0 */
export function depthOf(tree: ComponentTree, id: string): number {
  return ancestorsOf(tree, id).length;
}

/** 从根到该节点的名称路径（含自身） */
export function pathNamesOf(tree: ComponentTree, id: string): string[] {
  const node = tree.nodes[id];
  if (!node) return [];
  return [...ancestorsOf(tree, id).map((a) => a.name).reverse(), node.name];
}

/** 按类型计数（用于概览） */
export function countByType(tree: ComponentTree): Record<ComponentType, number> {
  const counts: Record<ComponentType, number> = {
    page: 0,
    section: 0,
    component: 0,
    element: 0,
  };
  for (const node of Object.values(tree.nodes)) counts[node.type] += 1;
  return counts;
}

/* ── 变更（不可变） ── */

/** 局部更新节点（不改变 children / 结构） */
export function updateComponent(
  tree: ComponentTree,
  id: string,
  patch: Partial<Omit<ComponentNode, "id">>,
): ComponentTree {
  const node = tree.nodes[id];
  if (!node) return tree;
  return { ...tree, nodes: { ...tree.nodes, [id]: { ...node, ...patch } } };
}

/** 记录一次组件的位置（画布拖动回写） */
export function moveComponent(
  tree: ComponentTree,
  id: string,
  rect: { x: number; y: number },
): ComponentTree {
  const node = tree.nodes[id];
  if (!node) return tree;
  return updateComponent(tree, id, { rect: { ...node.rect, ...rect } });
}
