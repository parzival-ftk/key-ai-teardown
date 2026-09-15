/**
 * Mermaid 渲染元素 id 生成（W15 抽出，W19 提到独立模块）。
 *
 * 必须是**跨实例唯一**：`mermaid.render(id)` 会创建同名临时元素、并在产出的 SVG 里嵌入
 * `#id{…}` 样式；两个实例用同一个 id 会同时造成「重复 DOM id」与「样式互相覆盖」。
 * 每实例私有 useRef 计数器做不到唯一，故需配合 React `useId()`，并滤掉其中的冒号
 * （冒号会让 `#id` 选择器非法）。
 *
 * 独立成模块的原因：图谱查看器与图谱编辑器（实时预览）都需要它，而两者不能互相 import
 * （查看器要引入编辑器，会成环）。把它放到共同依赖的叶子模块里，两边共用同一实现，
 * 避免「唯一性规则」在两处各写一遍而漂移。
 */
export function buildMermaidElementId(instanceKey: string, seq: number): string {
  const safe = instanceKey.replace(/[^a-zA-Z0-9]/g, "");
  return `mermaid-${safe}-${seq}`;
}
