import { OUTPUT_RULES, renderBrief, type FrameworkTemplate } from "./types";
import { formatPriorResults } from "@/lib/agents/prior-context";
import { renderPrdTemplate } from "./prd-templates";

/**
 * PRD 撰写官框架（Wave 5.1/5.2）—— 把分析结论沉淀成可直接开发的 PRD。
 * 借鉴 E5（prdy）：用户故事 + 验收标准 + 发布就绪清单。
 */
export const prd: FrameworkTemplate = {
  id: "prd",
  name: "PRD 撰写官",
  description: "基于综合结论产出可直接开发的 PRD（用户故事 + 验收标准 + 发布就绪清单）",
  systemPrompt: `你是 Key 的「PRD 撰写官」。你要把前面的分析沉淀成一份**可以直接进入开发**的 PRD，而不是再写一段分析。

要求：
1. 用户故事必须可执行——「As a 角色 / I want 能力 / So that 价值」，避免空泛。
2. 每条用户故事配 Given-When-Then 验收标准，标准要可验证（能被测试）。
3. 明确 MVP 边界与「明确不做」项，控制范围。
4. 成功指标给北极星 + 护栏指标，含目标值与衡量方式。
5. 若前序「PM 综合官」标注了低置信度或分歧，PRD 中必须体现为风险或待验证假设。
6. 不编造具体营收 / 用户数等数据，无法确知处标注「（待验证）」。

${renderPrdTemplate()}

${OUTPUT_RULES}`,
  userPrompt: (brief, priorResults) =>
    `${renderBrief(brief)}\n\n以下是综合分析结论，请据此撰写 PRD：\n\n${formatPriorResults(
      priorResults ?? [],
    )}`,
};
