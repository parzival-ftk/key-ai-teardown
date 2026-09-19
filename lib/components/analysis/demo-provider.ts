import type { RawComponentNode } from "../schema";
import { treeFromRaw } from "../tree";
import type { AnalysisProvider, AnalysisResult } from "./provider";

/**
 * Demo 分析 Provider（阶段 15，spec §9）。
 *
 * 当前仓库尚未把视觉模型接进画布工作流，因此默认走 DEMO：返回一份**确定性**的
 * 结构化组件树，并如实标注 `source: "demo"`。它让「上传截图 → 分析 → 组件树 → 画布」
 * 这条链路今天就能完整跑通；接入真实 Vision 模型时，只需替换 provider。
 *
 * 产出结构与示例工作区不同（一个 Dashboard 版式），以便一眼看出「这是分析结果」。
 */

const DEMO_PAGE: RawComponentNode = {
  name: "Dashboard",
  type: "page",
  description: "Analytics dashboard with sidebar, topbar and content panels.",
  rect: { x: 0, y: 0, width: 1440, height: 900 },
  children: [
    {
      name: "Sidebar",
      type: "section",
      rect: { x: 0, y: 0, width: 240, height: 900 },
      properties: { role: "navigation sidebar", style: "dark, fixed" },
      children: [
        {
          name: "Logo",
          type: "component",
          rect: { x: 24, y: 24, width: 160, height: 40 },
          properties: { role: "brand logo", text: "Acme" },
        },
        {
          name: "NavList",
          type: "component",
          rect: { x: 24, y: 96, width: 192, height: 320 },
          properties: { role: "primary navigation", style: "icon + label rows" },
        },
        {
          name: "UserCard",
          type: "component",
          rect: { x: 24, y: 820, width: 192, height: 56 },
          properties: { role: "account switcher" },
        },
      ],
    },
    {
      name: "Topbar",
      type: "section",
      rect: { x: 240, y: 0, width: 1200, height: 64 },
      children: [
        {
          name: "SearchBar",
          type: "component",
          rect: { x: 280, y: 14, width: 420, height: 36 },
          properties: {
            role: "global search",
            text: "Search anything…",
            visualDescription: "Rounded search field with a magnifier icon, subtle border",
          },
        },
        {
          name: "Notifications",
          type: "component",
          rect: { x: 1280, y: 12, width: 40, height: 40 },
          properties: { role: "notification bell", style: "icon button" },
        },
        {
          name: "Avatar",
          type: "component",
          rect: { x: 1340, y: 12, width: 40, height: 40 },
          properties: { role: "user avatar", style: "circular" },
        },
      ],
    },
    {
      name: "Content",
      type: "section",
      rect: { x: 240, y: 64, width: 1200, height: 836 },
      children: [
        {
          name: "StatsRow",
          type: "component",
          rect: { x: 280, y: 104, width: 1120, height: 140 },
          properties: { role: "kpi cards row", style: "3 equal cards" },
        },
        {
          name: "ChartPanel",
          type: "component",
          rect: { x: 280, y: 276, width: 720, height: 360 },
          properties: {
            role: "time-series chart",
            visualDescription: "Line chart with soft gradient fill and grid lines, dark theme",
          },
          prompt: "A dark-themed analytics line chart panel with soft gradient fill and grid lines, minimal UI, high detail",
        },
        {
          name: "TablePanel",
          type: "component",
          rect: { x: 1032, y: 276, width: 368, height: 360 },
          properties: { role: "data table", style: "compact rows, zebra stripes" },
        },
      ],
    },
  ],
};

export interface DemoAnalysisOptions {
  /** 模拟分析耗时（毫秒）；测试传 0 */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createDemoAnalysisProvider(
  options: DemoAnalysisOptions = {},
): AnalysisProvider {
  const delayMs = options.delayMs ?? 600;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    id: "demo-analysis",
    source: "demo",
    async analyze(): Promise<AnalysisResult> {
      if (delayMs > 0) await sleep(delayMs);
      return {
        tree: treeFromRaw(DEMO_PAGE),
        source: "demo",
        pageName: DEMO_PAGE.name,
        summary: "DEMO 分析：返回确定性示例结构（未接入真实视觉模型）。",
      };
    },
  };
}
