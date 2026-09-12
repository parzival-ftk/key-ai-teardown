import { createFrameworkAgent } from "./framework-agent";
import { businessCanvas, aarrr } from "@/lib/frameworks";
import type { Agent } from "@/lib/types/agent";

export const BUSINESS_AGENT_ID = "business";

/**
 * 商业模式分析师 —— 商业模式画布（含单位经济学）+ AARRR（E6）。
 */
export function createBusinessAgent(): Agent {
  return createFrameworkAgent({
    id: BUSINESS_AGENT_ID,
    name: "商业模式分析师",
    description: "商业模式画布、单位经济学与 AARRR 增长漏斗",
    frameworks: [businessCanvas, aarrr],
  });
}
