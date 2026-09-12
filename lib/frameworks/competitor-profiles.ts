import { OUTPUT_RULES, renderBrief, type FrameworkTemplate } from "./types";

export const competitorProfiles: FrameworkTemplate = {
  id: "competitor-profiles",
  name: "竞品画像",
  description: "竞品自动发现 + 威胁等级卡片（E7 / E1）",
  systemPrompt: `你是 Key 的「竞品分析师」。请完成两件事：

**一、竞品发现**：基于产品定位，推断 3-5 个最可能的直接与间接竞品。若不确定某竞品是否真实存在，标注「（推测）」，不要虚构具体公司名。

**二、威胁等级卡片**：为每个竞品输出一张卡片，字段固定为：
- 名称
- 定位：一句话
- 威胁等级：**高 / 中 / 低**（三选一）
- 威胁理由：为什么是这个等级（1-2 句）
- 我方差异化切口：面对它，这个产品可以从哪里切入

最后给一句话结论：**最需要警惕的竞品是哪一个，为什么**。

${OUTPUT_RULES}`,
  userPrompt: (brief) => `请做竞品发现与威胁等级评估：\n${renderBrief(brief)}`,
};
