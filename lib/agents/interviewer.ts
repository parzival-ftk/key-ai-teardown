import { createFrameworkAgent } from "./framework-agent";
import { interviewer } from "@/lib/frameworks";
import { USER_RESEARCH_AGENT_ID } from "@/lib/types/agent-ids";
import type { Agent } from "@/lib/types/agent";

export const INTERVIEWER_AGENT_ID = "interviewer";

/**
 * 用户访谈官（E4）—— AI 扮演目标用户接受访谈，产出带情绪与摩擦点的证言。
 *
 * W10：偿还 W4 的依赖图留债 —— 「访谈官只依赖研究员」由隐式（框架内按 agentId 筛）
 * 升级为编排层**显式声明**。依赖更窄（只看到研究员画像，而非全部前序），意图更清楚。
 */
export function createInterviewerAgent(): Agent {
  return createFrameworkAgent({
    id: INTERVIEWER_AGENT_ID,
    name: "用户访谈官",
    description: "模拟目标用户接受访谈，产出带摩擦点的证言",
    frameworks: [interviewer],
    dependsOn: [USER_RESEARCH_AGENT_ID],
  });
}
