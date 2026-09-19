import type { ComponentNode, ComponentTree } from "./types";

/**
 * 组件 Prompt 生成（阶段 15，spec §12）。
 *
 * 每个组件都可以拥有独立 Prompt：优先用组件自带的 `prompt`，否则由可读属性
 * **确定性**推导。生成层只拿到一个字符串，不关心它来自手工填写还是自动推导。
 */

/** 由组件属性推导一段面向生成模型的视觉描述（确定性、无副作用） */
export function derivePrompt(node: ComponentNode): string {
  const visual = node.properties?.visualDescription?.trim();
  if (visual) return visual;

  const parts: string[] = [node.name];
  const role = node.properties?.role?.trim();
  if (role) parts.push(role);
  const text = node.properties?.text?.trim();
  if (text) parts.push(`with the text "${text}"`);
  const style = node.properties?.style?.trim();
  if (style) parts.push(style);
  parts.push(`${TYPE_NOUN[node.type]} UI element`);
  return parts.join(", ");
}

/** 组件的生效 Prompt：自带优先，否则推导 */
export function componentPrompt(tree: ComponentTree, componentId: string): string {
  const node = tree.nodes[componentId];
  if (!node) return "";
  const explicit = node.prompt?.trim();
  return explicit ? explicit : derivePrompt(node);
}

const TYPE_NOUN: Record<ComponentNode["type"], string> = {
  page: "page",
  section: "section",
  component: "component",
  element: "element",
};
