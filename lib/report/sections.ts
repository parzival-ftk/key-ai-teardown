/**
 * 报告 7 段式章节定义（E1）—— 单一事实来源。
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
  { key: "users", title: "用户与场景", agentId: "user-research", owner: "用户研究员" },
  { key: "interview", title: "用户访谈实录", agentId: "interviewer", owner: "用户访谈官" },
  { key: "visual", title: "视觉设计拆解", agentId: "visual-design", owner: "视觉设计分析师" },
  { key: "business", title: "商业模式", agentId: "business", owner: "商业模式分析师" },
  { key: "critique", title: "反方质疑", agentId: "devils-advocate", owner: "反方质疑官" },
  { key: "synthesis", title: "综合结论与建议", agentId: "synthesis", owner: "PM 综合官" },
  {
    key: "prd",
    title: "PRD（用户故事 + 验收标准）",
    agentId: "prd",
    owner: "PRD 撰写官",
  },
];
