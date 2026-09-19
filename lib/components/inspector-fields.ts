import type { ComponentNode, ComponentTree, ComponentType } from "./types";
import { countByType, depthOf, pathNamesOf } from "./tree";

/**
 * Inspector 的展示数据（阶段 15，spec §11，纯函数）。
 *
 * 把组件节点摊成一组「标签 → 值」的只读字段，供 Inspector 渲染。
 * 与 `lib\report\sections` 同一思路：展示结构是数据，不是散落在 JSX 里的字面量。
 */

export const COMPONENT_TYPE_LABEL: Record<ComponentType, string> = {
  page: "页面",
  section: "区块",
  component: "组件",
  element: "元素",
};

export interface InspectorField {
  /** 稳定 key（测试与 DOM 属性用） */
  key: "name" | "type" | "role" | "description" | "text" | "style";
  label: string;
  value: string;
}

/** 组件在 Inspector 里展示的字段（值为空的字段也保留，便于用户看到「缺失」） */
export function componentFields(node: ComponentNode): InspectorField[] {
  return [
    { key: "name", label: "Name", value: node.name },
    { key: "type", label: "Type", value: COMPONENT_TYPE_LABEL[node.type] },
    { key: "role", label: "Role", value: node.properties?.role ?? "" },
    { key: "description", label: "Description", value: node.description ?? "" },
    { key: "text", label: "Text", value: node.properties?.text ?? "" },
    { key: "style", label: "Visual Style", value: node.properties?.style ?? "" },
  ];
}

/** 组件在树中的位置摘要（面包屑），用于 Inspector 头部 */
export function componentBreadcrumb(tree: ComponentTree, componentId: string): string[] {
  return pathNamesOf(tree, componentId);
}

/** 组件深度与子组件数量（Inspector 概览行） */
export function componentStats(
  tree: ComponentTree,
  componentId: string,
): { depth: number; childCount: number } {
  const node = tree.nodes[componentId];
  return { depth: depthOf(tree, componentId), childCount: node?.children.length ?? 0 };
}

/** 整棵树的层级概览（工作区头部展示） */
export function treeOverview(tree: ComponentTree): { total: number; byType: Record<ComponentType, number> } {
  return { total: Object.keys(tree.nodes).length, byType: countByType(tree) };
}
