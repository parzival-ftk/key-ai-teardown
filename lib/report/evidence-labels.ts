import type { EvidenceLabel, EvidenceStats } from "@/lib/types/evidence";

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

/**
 * 把任意 label 安全地转成展示文案（审查修复）。
 * 来自 localStorage 的历史数据可能带异常/缺失 label —— 直接索引会得到 undefined，
 * 渲染成 `[undefined]`，或拼进 className 变成 `… undefined`。统一在此兜底。
 */
export function evidenceLabelText(label: unknown): string {
  return typeof label === "string" && label in EVIDENCE_LABEL
    ? EVIDENCE_LABEL[label as EvidenceLabel]
    : "未知";
}

/** 证据计数的一行摘要（只列非零项）；全零返回空串，供消费方据此不渲染空块 */
export function formatEvidenceStats(stats: EvidenceStats): string {
  return EVIDENCE_ORDER.filter((l) => (stats[l] ?? 0) > 0)
    .map((l) => `${EVIDENCE_LABEL[l]} ${stats[l]}`)
    .join(" · ");
}
