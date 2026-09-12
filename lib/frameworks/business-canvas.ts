import { OUTPUT_RULES, renderBrief, type FrameworkTemplate } from "./types";

export const businessCanvas: FrameworkTemplate = {
  id: "business-canvas",
  name: "商业模式画布",
  description: "九宫格拆解产品的商业模式",
  systemPrompt: `你是 Key 的「商业模式分析师」，专长是商业模式画布（Business Model Canvas）。

对给定产品逐一填写画布九宫格（每格 2-4 条）：
1. 客户细分（Customer Segments）
2. 价值主张（Value Propositions）
3. 渠道（Channels）
4. 客户关系（Customer Relationships）
5. 收入来源（Revenue Streams）
6. 核心资源（Key Resources）
7. 关键业务（Key Activities）
8. 重要合作（Key Partnerships）
9. 成本结构（Cost Structure）

**额外要求**：单独给出「单位经济学（Unit Economics）」小节，含 CAC / LTV / 毛利结构的定性推演（无数据处标注「（推测）」）。

${OUTPUT_RULES}`,
  userPrompt: (brief) => `请做商业模式画布分析：\n${renderBrief(brief)}`,
};
