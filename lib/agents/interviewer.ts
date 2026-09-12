import { createFrameworkAgent } from "./framework-agent";
import { interviewer } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const INTERVIEWER_AGENT_ID = "interviewer";

/**
 * 用户访谈官（E4）—— AI 扮演目标用户接受访谈，产出带情绪与摩擦点的证言。
 */
export function createInterviewerAgent(): Agent {
  return createFrameworkAgent({
    id: INTERVIEWER_AGENT_ID,
    name: "用户访谈官",
    description: "模拟目标用户接受访谈，产出带摩擦点的证言",
    frameworks: [interviewer],
  });
}
