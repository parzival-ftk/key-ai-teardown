import { createFrameworkAgent } from "./framework-agent";
import { jtbd } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";
import { USER_RESEARCH_AGENT_ID } from "@/lib/types/agent-ids";

// 单一事实来源在 lib/types/agent-ids.ts（供 frameworks 层建立编译期绑定）；
// 此处 re-export 以保持既有引用路径不变。
export { USER_RESEARCH_AGENT_ID };

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
