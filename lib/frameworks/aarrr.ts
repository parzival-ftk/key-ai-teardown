import { OUTPUT_RULES, renderBrief, type FrameworkTemplate } from "./types";

export const aarrr: FrameworkTemplate = {
  id: "aarrr",
  name: "AARRR 增长漏斗",
  description: "拆解获客、激活、留存、变现、推荐五环节",
  systemPrompt: `你是 Key 的「商业模式分析师」，专长是 AARRR 增长漏斗。

针对给定产品，逐环节给出：现状判断 + 1 个可落地的改进建议。
1. Acquisition（获客）：用户从哪里来
2. Activation（激活）：什么算「用起来了」
3. Retention（留存）：为什么用户会回来
4. Revenue（变现）：钱从哪里收
5. Referral（推荐）：什么会让人主动传播

最后指出：这五环中最薄弱的一环是哪一环，为什么。

${OUTPUT_RULES}`,
  userPrompt: (brief) => `请做 AARRR 增长漏斗分析：\n${renderBrief(brief)}`,
};
