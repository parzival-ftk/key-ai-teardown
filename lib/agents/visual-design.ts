import { createFrameworkAgent } from "./framework-agent";
import { visualDesign } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const VISUAL_DESIGN_AGENT_ID = "visual-design";

/**
 * 视觉设计分析师（W5 · L1）—— 拆解界面的视觉设计语言
 * （色板 / 字体层级 / 间距节奏 / 组件类型 / 布局模式）。
 *
 * 截图输入时由多模态模型据实分析；纯文本输入时按描述推断并标注「（推测）」。
 */
export function createVisualDesignAgent(): Agent {
  return createFrameworkAgent({
    id: VISUAL_DESIGN_AGENT_ID,
    name: "视觉设计分析师",
    description: "拆解界面视觉设计语言（色板 / 字体层级 / 间距 / 组件 / 布局）",
    frameworks: [visualDesign],
  });
}
