import type { Project } from "./types";
import type { RawComponentNode } from "./schema";
import { treeFromRaw } from "./tree";

/**
 * 内置示例工作区（阶段 15）。见 spec §16。
 *
 * 它不是「演示素材」，而是产品本身的 **示例工作区**：
 * 打开即可选中「插图」→ 查看提示词 → 生成，无需先上传截图就能体验核心闭环。
 *
 * 坐标是手工调过的整齐版式（父级 frame 铺底、子组件在其内），便于一眼看清层级；
 * 「插图」预置了一段面向生成模型的视觉描述与提示词（英文，供 ComfyUI 使用）。
 */

export const EXAMPLE_PROJECT_ID = "example-landing-page";
export const EXAMPLE_PROJECT_NAME = "落地页示例";

const EXAMPLE_TREE: RawComponentNode = {
  name: "落地页",
  type: "page",
  description: "产品的营销落地页。",
  rect: { x: 0, y: 0, width: 1280, height: 1080 },
  children: [
    {
      name: "页眉",
      type: "section",
      description: "顶部导航栏，含品牌标识与主要操作。",
      rect: { x: 40, y: 40, width: 1200, height: 88 },
      properties: { role: "网站页眉", text: "产品名称", style: "深色、简约" },
    },
    {
      name: "主视觉",
      type: "section",
      description: "首屏主视觉，含标题、搜索与插图。",
      rect: { x: 40, y: 168, width: 1200, height: 380 },
      children: [
        {
          name: "标题",
          type: "component",
          rect: { x: 80, y: 224, width: 460, height: 88 },
          properties: { role: "主标题", text: "瞬间找到任何东西", style: "粗体、48px" },
        },
        {
          name: "搜索框",
          type: "component",
          rect: { x: 80, y: 344, width: 460, height: 64 },
          properties: {
            role: "搜索输入框",
            text: "搜索产品…",
            style: "圆角胶囊、微光",
            visualDescription:
              "Rounded pill-shaped search input with a magnifier icon and soft blue glow",
          },
        },
        {
          name: "插图",
          type: "component",
          description: "主视觉插图，可用 ComfyUI 重新生成。",
          rect: { x: 600, y: 200, width: 600, height: 320 },
          properties: {
            role: "主视觉插图",
            style: "深色、电影感、蓝色霓虹",
            visualDescription:
              "A cinematic futuristic city at night, minimal dark interface aesthetic, blue neon lights, wide composition, high detail",
          },
          prompt:
            "A cinematic futuristic city at night, minimal dark interface aesthetic, blue neon lights, wide composition, high detail",
        },
      ],
    },
    {
      name: "特性区",
      type: "section",
      description: "三列特性栅格。",
      rect: { x: 40, y: 588, width: 1200, height: 300 },
    },
    {
      name: "页脚",
      type: "section",
      rect: { x: 40, y: 928, width: 1200, height: 88 },
      properties: { role: "页脚", text: "© 2026 产品名称" },
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
