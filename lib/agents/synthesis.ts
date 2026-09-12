import { createFrameworkAgent } from "./framework-agent";
import { synthesis } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const SYNTHESIS_AGENT_ID = "synthesis";

/**
 * PM 综合官 —— 收敛全部结论、标注置信度、给执行摘要（Wave 3）。
 */
export function createSynthesisAgent(): Agent {
  return createFrameworkAgent({
    id: SYNTHESIS_AGENT_ID,
    name: "PM 综合官",
    description: "收敛全部结论、标注置信度并给出执行摘要",
    frameworks: [synthesis],
  });
}
