import type { Project } from "./types";
import type { RawComponentNode } from "./schema";
import { treeFromRaw } from "./tree";

/**
 * 内置示例工作区（阶段 15）。见 spec §16。
 *
 * 它不是「演示素材」，而是产品本身的 **Sample Project / Example Workspace**：
 * 打开即可选中 Illustration → 查看 Prompt → 生成，无需先上传截图就能体验核心闭环。
 *
 * 坐标是手工调过的整齐版式（父级 frame 铺底、子组件在其内），便于一眼看清层级；
 * Illustration 预置了一段面向生成模型的视觉描述与 Prompt。
 */

export const EXAMPLE_PROJECT_ID = "example-landing-page";
export const EXAMPLE_PROJECT_NAME = "Landing Page";

const EXAMPLE_TREE: RawComponentNode = {
  name: "Landing Page",
  type: "page",
  description: "Marketing landing page for a product.",
  rect: { x: 0, y: 0, width: 1280, height: 1080 },
  children: [
    {
      name: "Header",
      type: "section",
      description: "Top navigation bar with logo and primary actions.",
      rect: { x: 40, y: 40, width: 1200, height: 88 },
      properties: { role: "site header", text: "Product Name", style: "dark, minimal" },
    },
    {
      name: "Hero",
      type: "section",
      description: "Above-the-fold hero with title, search and illustration.",
      rect: { x: 40, y: 168, width: 1200, height: 380 },
      children: [
        {
          name: "Title",
          type: "component",
          rect: { x: 80, y: 224, width: 460, height: 88 },
          properties: { role: "headline", text: "Find anything, instantly", style: "bold, 48px" },
        },
        {
          name: "SearchBox",
          type: "component",
          rect: { x: 80, y: 344, width: 460, height: 64 },
          properties: {
            role: "search input",
            text: "Search products…",
            style: "rounded pill, subtle glow",
            visualDescription: "Rounded pill-shaped search input with a magnifier icon and soft blue glow",
          },
        },
        {
          name: "Illustration",
          type: "component",
          description: "Hero illustration that can be regenerated with ComfyUI.",
          rect: { x: 600, y: 200, width: 600, height: 320 },
          properties: {
            role: "hero illustration",
            style: "dark, cinematic, blue neon",
            visualDescription:
              "A cinematic futuristic city at night, minimal dark interface aesthetic, blue neon lights, wide composition, high detail",
          },
          prompt:
            "A cinematic futuristic city at night, minimal dark interface aesthetic, blue neon lights, wide composition, high detail",
        },
      ],
    },
    {
      name: "Features",
      type: "section",
      description: "Three-column feature grid.",
      rect: { x: 40, y: 588, width: 1200, height: 300 },
    },
    {
      name: "Footer",
      type: "section",
      rect: { x: 40, y: 928, width: 1200, height: 88 },
      properties: { role: "footer", text: "© 2026 Product Name" },
    },
  ],
};

/** 构造一份全新的示例项目（每次返回独立副本，调用方可自由改动） */
export function createExampleProject(now: number = Date.now()): Project {
  return {
    id: EXAMPLE_PROJECT_ID,
    name: EXAMPLE_PROJECT_NAME,
    source: "example",
    createdAt: now,
    updatedAt: now,
    tree: treeFromRaw(EXAMPLE_TREE),
    assets: [],
  };
}
