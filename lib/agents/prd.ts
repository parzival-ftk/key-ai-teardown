import { createFrameworkAgent } from "./framework-agent";
import { prd } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const PRD_AGENT_ID = "prd";

/**
 * PRD 撰写官 —— 读取全部分析与综合结论，产出可直接开发的 PRD（Wave 5）。
 */
export function createPrdAgent(): Agent {
  return createFrameworkAgent({
    id: PRD_AGENT_ID,
    name: "PRD 撰写官",
    description: "基于综合结论产出可直接开发的 PRD（用户故事 + 验收标准 + 发布清单）",
    frameworks: [prd],
  });
}
