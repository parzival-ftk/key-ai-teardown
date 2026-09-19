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
 * 产出结构与示例工作区不同（一个仪表盘版式），以便一眼看出「这是分析结果」。
 * 组件名与可读属性用中文；面向生成模型的 visualDescription / prompt 保留英文。
 */

const DEMO_PAGE: RawComponentNode = {
  name: "仪表盘",
  type: "page",
  description: "带侧边栏、顶栏与内容面板的数据分析仪表盘。",
  rect: { x: 0, y: 0, width: 1440, height: 900 },
  children: [
    {
      name: "侧边栏",
      type: "section",
      rect: { x: 0, y: 0, width: 240, height: 900 },
      properties: { role: "导航侧边栏", style: "深色、固定" },
      children: [
        {
          name: "标志",
          type: "component",
          rect: { x: 24, y: 24, width: 160, height: 40 },
          properties: { role: "品牌标志", text: "Acme" },
        },
        {
          name: "导航列表",
          type: "component",
          rect: { x: 24, y: 96, width: 192, height: 320 },
          properties: { role: "主导航", style: "图标 + 标签行" },
        },
        {
          name: "用户卡片",
          type: "component",
          rect: { x: 24, y: 820, width: 192, height: 56 },
          properties: { role: "账号切换" },
        },
      ],
    },
    {
      name: "顶栏",
      type: "section",
      rect: { x: 240, y: 0, width: 1200, height: 64 },
      children: [
        {
          name: "搜索栏",
          type: "component",
          rect: { x: 280, y: 14, width: 420, height: 36 },
          properties: {
            role: "全局搜索",
            text: "搜索任何内容…",
            visualDescription: "Rounded search field with a magnifier icon, subtle border",
          },
        },
        {
          name: "通知",
          type: "component",
          rect: { x: 1280, y: 12, width: 40, height: 40 },
          properties: { role: "通知铃铛", style: "图标按钮" },
        },
        {
          name: "头像",
          type: "component",
          rect: { x: 1340, y: 12, width: 40, height: 40 },
          properties: { role: "用户头像", style: "圆形" },
        },
      ],
    },
    {
      name: "内容区",
      type: "section",
      rect: { x: 240, y: 64, width: 1200, height: 836 },
      children: [
        {
          name: "指标行",
          type: "component",
          rect: { x: 280, y: 104, width: 1120, height: 140 },
          properties: { role: "KPI 卡片行", style: "3 张等宽卡片" },
        },
        {
          name: "图表面板",
          type: "component",
          rect: { x: 280, y: 276, width: 720, height: 360 },
          properties: {
            role: "时间序列图",
            visualDescription: "Line chart with soft gradient fill and grid lines, dark theme",
          },
          prompt:
            "A dark-themed analytics line chart panel with soft gradient fill and grid lines, minimal UI, high detail",
        },
        {
          name: "表格面板",
          type: "component",
          rect: { x: 1032, y: 276, width: 368, height: 360 },
          properties: { role: "数据表格", style: "紧凑行、斑马纹" },
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
