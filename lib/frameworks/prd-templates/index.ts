import {
  LAUNCH_CHECKLIST,
  LAUNCH_CHECKLIST_CATEGORIES,
  type LaunchChecklistItem,
} from "./launch-checklist";

export { LAUNCH_CHECKLIST, LAUNCH_CHECKLIST_CATEGORIES };
export type { LaunchChecklistItem };

/**
 * PRD 模板库（Wave 5.1）—— 首版为静态模板，作为 RAG 检索的种子结构
 * （spec §11 开放问题：先内置静态模板，向量检索留待后续）。
 */

export interface PrdSectionSpec {
  key: string;
  title: string;
  guidance: string;
}

/** PRD 章节骨架 */
export const PRD_SECTIONS: PrdSectionSpec[] = [
  {
    key: "background",
    title: "背景与目标",
    guidance: "一句话说清要解决的问题，并给出可度量的目标。",
  },
  {
    key: "stories",
    title: "用户故事与验收标准",
    guidance: "每条用户故事用 As a / I want / So that；每条配 Given-When-Then 验收标准。",
  },
  {
    key: "scope",
    title: "功能范围",
    guidance: "区分 MVP（首版必做）与后续迭代，并明确「不做什么」。",
  },
  {
    key: "metrics",
    title: "成功指标",
    guidance: "1 个北极星指标 + 2-3 个护栏指标，各含目标值与衡量方式。",
  },
  {
    key: "risks",
    title: "风险与依赖",
    guidance: "列出关键风险与外部依赖，各给缓解措施。",
  },
  {
    key: "launch",
    title: "发布就绪清单",
    guidance: "对照清单逐项给出「已满足 / 待办 / 不适用」。",
  },
];

/** 把 PRD 模板库渲染为系统提示词片段（章节结构 + 发布清单） */
export function renderPrdTemplate(): string {
  const sections = PRD_SECTIONS.map(
    (s, i) => `${i + 1}. **${s.title}**：${s.guidance}`,
  ).join("\n");
  const checklist = LAUNCH_CHECKLIST.map(
    (c) => `- [${c.category}] ${c.label}`,
  ).join("\n");
  return `产出必须严格包含以下章节（中文 Markdown）：\n${sections}\n\n发布就绪清单（最后一节须逐项评估）：\n${checklist}`;
}
