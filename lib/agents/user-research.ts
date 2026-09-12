import { createFrameworkAgent } from "./framework-agent";
import { jtbd } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const USER_RESEARCH_AGENT_ID = "user-research";

/**
 * 用户研究员 —— JTBD（用户画像 + 三层 job + unmet needs）。
 */
export function createUserResearchAgent(): Agent {
  return createFrameworkAgent({
    id: USER_RESEARCH_AGENT_ID,
    name: "用户研究员",
    description: "用户画像、JTBD 与核心场景",
    frameworks: [jtbd],
  });
}
