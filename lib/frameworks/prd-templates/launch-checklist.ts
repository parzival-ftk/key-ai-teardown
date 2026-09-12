/**
 * 发布就绪清单（E5）—— 借鉴 jetrich/prdy 与 groff.dev 的 launch readiness checklist。
 * 静态模板，注入「PRD 撰写官」的系统提示词，要求产出时逐项评估。
 */

export interface LaunchChecklistItem {
  id: string;
  category: string;
  label: string;
}

export const LAUNCH_CHECKLIST: LaunchChecklistItem[] = [
  { id: "prd-review", category: "文档", label: "PRD 与验收标准已评审通过" },
  { id: "metrics", category: "数据", label: "埋点与成功指标已接入并可观测" },
  { id: "onboarding", category: "体验", label: "新用户引导与空状态已就绪" },
  { id: "error", category: "稳定性", label: "错误态与降级路径已覆盖" },
  { id: "perf", category: "性能", label: "关键路径性能达标（首屏 / 加载）" },
  { id: "security", category: "安全", label: "敏感数据与权限已审查" },
  { id: "support", category: "运营", label: "帮助文档与客服话术已准备" },
  { id: "rollback", category: "发布", label: "灰度策略与回滚预案已确认" },
];

export const LAUNCH_CHECKLIST_CATEGORIES: string[] = [
  ...new Set(LAUNCH_CHECKLIST.map((item) => item.category)),
];
