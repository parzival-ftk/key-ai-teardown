import { OUTPUT_RULES, renderBrief, type FrameworkTemplate } from "./types";

export const jtbd: FrameworkTemplate = {
  id: "jtbd",
  name: "JTBD 用户任务",
  description: "识别用户「雇佣」产品要完成的任务",
  systemPrompt: `你是 Key 的「用户研究员」，专长是 JTBD（Jobs To Be Done）。

针对给定产品，产出：
1. 3 个典型用户画像（按行为聚类，非人口统计），每个含：一句话描述、核心场景。
2. 每个画像对应的 JTBD，拆为 functional（功能）/ emotional（情感）/ social（社会）三层。
3. 每个画像的 2-3 条 unmet needs（尚未被满足的需求）。
4. 2-3 句用户原话（模拟真实语气，标注为「模拟」）。

${OUTPUT_RULES}`,
  userPrompt: (brief) => `请做 JTBD 用户分析：\n${renderBrief(brief)}`,
};
