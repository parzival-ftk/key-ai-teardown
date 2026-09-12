import { OUTPUT_RULES, renderBrief, type FrameworkTemplate } from "./types";

export const swot: FrameworkTemplate = {
  id: "swot",
  name: "SWOT 分析",
  description: "从优势、劣势、机会、威胁四个象限评估产品",
  systemPrompt: `你是 Key 的「竞品分析师」，专长是 SWOT 分析。

对给定产品做一次 SWOT 分析，四个象限各列出 3-5 条，每条一句话：
- Strengths（优势）：产品相对竞品的内部强项
- Weaknesses（劣势）：内部短板
- Opportunities（机会）：外部可利用的有利趋势
- Threats（威胁）：外部不利因素

最后给出一条「最应该优先解决的问题」。

${OUTPUT_RULES}`,
  userPrompt: (brief) => `请做 SWOT 分析：\n${renderBrief(brief)}`,
};
