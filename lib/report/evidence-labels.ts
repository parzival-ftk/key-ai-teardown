import type { EvidenceLabel } from "@/lib/types/evidence";

/**
 * 证据标签 → 中文展示文案（W2）—— 单一事实来源。
 * 直播视图（analyze-view）、报告视图（report-view）与 Markdown 导出共享，
 * 避免三处各写一份而漂移。
 */
export const EVIDENCE_LABEL: Record<EvidenceLabel, string> = {
  verified: "已核实",
  inferred: "推测",
  missing: "缺失",
};

/** 标签的展示顺序（总览/列表统一） */
export const EVIDENCE_ORDER: EvidenceLabel[] = [
  "verified",
  "inferred",
  "missing",
];
