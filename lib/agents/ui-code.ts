import { createFrameworkAgent } from "./framework-agent";
import { uiCode } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const UI_CODE_AGENT_ID = "ui-code";

/**
 * 界面代码生成师（W6 · L2）—— 把界面还原为 HTML + Tailwind 的代码起点。
 *
 * 截图输入时由多模态模型直接读界面；纯文本输入时按描述推断并保持中性占位。
 * 产出始终是「参考起点」，报告里以可复制的代码面板呈现。
 */
export function createUiCodeAgent(): Agent {
  return createFrameworkAgent({
    id: UI_CODE_AGENT_ID,
    name: "界面代码生成师",
    description: "把界面还原为 HTML + Tailwind 的代码起点（参考起点，非复刻）",
    frameworks: [uiCode],
  });
}
