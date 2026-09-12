import { USER_RESEARCH_AGENT_ID } from "@/lib/types/agent-ids";

/**
 * 报告章节定义（E1）—— 单一事实来源。
 * report-view（展示）与 export（导出）共用，避免两处漂移。
 */

export interface ReportSectionSpec {
  /** 章节 key（展示用） */
  key: string;
  /** 章节标题 */
  title: string;
  /** 对应 Agent id（用于按 agentId 取该段内容） */
  agentId: string;
  /** 负责的 Agent 展示名 */
  owner: string;
}

export const REPORT_SECTIONS: ReportSectionSpec[] = [
  { key: "market", title: "市场与竞争格局", agentId: "market", owner: "竞品分析师" },
  { key: "users", title: "用户与场景", agentId: USER_RESEARCH_AGENT_ID, owner: "用户研究员" },
  { key: "interview", title: "用户访谈实录", agentId: "interviewer", owner: "用户访谈官" },
  { key: "visual", title: "视觉设计拆解", agentId: "visual-design", owner: "视觉设计分析师" },
  { key: "business", title: "商业模式", agentId: "business", owner: "商业模式分析师" },
  { key: "critique", title: "反方质疑", agentId: "devils-advocate", owner: "反方质疑官" },
  { key: "rebuttal", title: "质疑答辩（逐条回应）", agentId: "rebuttal", owner: "答辩官" },
  { key: "synthesis", title: "综合结论与建议", agentId: "synthesis", owner: "PM 综合官" },
  {
    key: "prd",
    title: "PRD（用户故事 + 验收标准）",
    agentId: "prd",
    owner: "PRD 撰写官",
  },
  {
    key: "ui-code",
    title: "界面代码（参考起点，请自行设计）",
    agentId: "ui-code",
    owner: "界面代码生成师",
  },
];
