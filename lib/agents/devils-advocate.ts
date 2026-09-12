import { createFrameworkAgent } from "./framework-agent";
import { devilsAdvocate } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const DEVILS_ADVOCATE_AGENT_ID = "devils-advocate";

/**
 * 反方质疑官 —— 读取前序分析结果并挑战其假设（E3 辩论机制）。
 */
export function createDevilsAdvocateAgent(): Agent {
  return createFrameworkAgent({
    id: DEVILS_ADVOCATE_AGENT_ID,
    name: "反方质疑官",
    description: "挑战前序分析的关键假设，输出反驳点与尖锐问题",
    frameworks: [devilsAdvocate],
  });
}
