import { createFrameworkAgent } from "./framework-agent";
import { fiveForces, swot, competitorProfiles } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const MARKET_AGENT_ID = "market";

/**
 * 竞品分析师 —— 波特五力 + SWOT + 竞品画像/威胁等级（E1）。
 */
export function createMarketAgent(): Agent {
  return createFrameworkAgent({
    id: MARKET_AGENT_ID,
    name: "竞品分析师",
    description: "竞品格局、竞争壁垒、威胁等级（波特五力 + SWOT + 竞品画像）",
    frameworks: [fiveForces, swot, competitorProfiles],
  });
}
