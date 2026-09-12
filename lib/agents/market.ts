import { createFrameworkAgent } from "./framework-agent";
import { fiveForces, swot } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const MARKET_AGENT_ID = "market";

/**
 * 竞品分析师 —— 波特五力 + SWOT（Wave 2 起由框架库驱动）。
 */
export function createMarketAgent(): Agent {
  return createFrameworkAgent({
    id: MARKET_AGENT_ID,
    name: "竞品分析师",
    description: "分析竞品格局、竞争壁垒与威胁（波特五力 + SWOT）",
    frameworks: [fiveForces, swot],
  });
}
