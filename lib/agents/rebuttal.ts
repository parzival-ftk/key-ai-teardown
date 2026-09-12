import { createFrameworkAgent } from "./framework-agent";
import { rebuttal } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const REBUTTAL_AGENT_ID = "rebuttal";

/**
 * 答辩官（W10 · 真辩论）—— 对反方质疑逐条答辩，交综合官裁决。
 *
 * 辩论流程：反方质疑官（质疑）→ 答辩官（逐条答辩）→ PM 综合官（裁决分歧）。
 * 单轮辩论 + 裁决，DAG 无环，故不会无限辩论（收敛判据见框架提示词与 orchestrator）。
 */
export function createRebuttalAgent(): Agent {
  return createFrameworkAgent({
    id: REBUTTAL_AGENT_ID,
    name: "答辩官",
    description: "对反方质疑逐条答辩（接受 / 反驳 / 存疑），并给出结论修正",
    frameworks: [rebuttal],
  });
}
