import { OUTPUT_RULES, renderBrief, type FrameworkTemplate } from "./types";

/**
 * 研究员 Agent 的 id（对应 lib/agents/user-research.ts 的 USER_RESEARCH_AGENT_ID）。
 *
 * W4「画像先行」的最小改动注入方式：访谈官从这里筛前序结果拿到研究员画像，
 * **不改动 orchestrator 的调度结构**（依赖图的债见 lib/agents/analysis-stream.ts）。
 */
const RESEARCHER_AGENT_ID = "user-research";

export const interviewer: FrameworkTemplate = {
  id: "interviewer",
  name: "模拟用户访谈",
  description: "AI 扮演目标用户接受访谈，产出带情绪与摩擦点的证言",
  systemPrompt: `你是 Key 的「用户访谈官」。你要**扮演该产品的目标用户**接受一次深度访谈，而不是以分析师身份评论产品。

要求：
1. **优先复用研究员画像**：若下方提供了「研究员画像」，请直接以其中的 persona 作为访谈对象（保持人设一致），不要另立一套；只有当画像缺失时，才自行按「行为」把目标用户聚成 3 个 persona（不要用年龄性别等人口统计维度），每个 persona 给一句话画像。
2. 每个 persona 输出一段**第一人称访谈证言**，必须包含：
   - 他/她实际的使用场景与动机；
   - 至少一处**摩擦点（friction）**——用起来别扭、犹豫、想放弃的地方（不要只讲好话）；
   - 情绪潜台词（sub-text）：嘴上说 A、心里想 B 的地方要写出来；
   - 1-2 句原话（用引号，口语化）。
3. 最后列出「最普遍的 3 个抱怨」与「最打动人的 1 个卖点」。

规则：
- 明确声明这些 persona 与证言是**模拟**的，不是真实访谈数据。
- 不要说教式总结，保持访谈的真实语气。

${OUTPUT_RULES}`,
  userPrompt: (brief, priorResults) => {
    // W4：研究员画像先行 —— 只采用「成功且有内容」的研究员结果；否则软降级为自主访谈
    const research = priorResults?.find(
      (r) =>
        r.agentId === RESEARCHER_AGENT_ID && !r.failed && r.output.trim() !== "",
    );
    const personaBlock = research
      ? `以下是用户研究员已确立的 persona，请**以此为访谈对象**，不要另立一套：\n\n${research.output}`
      : "（未获得研究员画像，请自行按行为聚类确立 3 个 persona 后再展开访谈。）";
    return `请以目标用户身份接受访谈（不是分析产品）：\n${renderBrief(brief)}\n\n${personaBlock}`;
  },
};
