"use client";

import { useState } from "react";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import type { ThoughtTreeNode } from "@/lib/agents/thought-tree";

/**
 * 节点干预弹窗（W24）—— Human-in-the-loop 的入口。
 *
 * 在某个推理节点上给出修正指令（可点快捷预设），点「重新推理此分支」后
 * 由宿主回调触发分支重算（`onSubmit`）。组件只接 props，不触碰存储与网络。
 */

/** agent id → 展示名（复用报告章节 owner） */
const AGENT_DISPLAY: Record<string, string> = Object.fromEntries(
  REPORT_SECTIONS.map((s) => [s.agentId, s.owner]),
);

const GENERIC_PRESETS = [
  "补充安全性约束",
  "补充合规要求（GDPR / 隐私）",
  "补充成本与资源约束",
  "给出更保守的结论",
];

/** 针对 Agent 角色的预设指令 */
const AGENT_PRESETS: Record<string, string[]> = {
  market: ["补充新兴竞品覆盖", "补充定价与商业化对比"],
  "user-research": ["补充边缘用户场景", "补充可访问性要求"],
  interviewer: ["追问数据来源与样本量", "补充反例访谈"],
  "visual-design": ["补充深色模式与对比度要求", "统一设计令牌命名"],
  business: ["补充单位经济模型", "补充合规与政策风险"],
  "devils-advocate": ["再补一条最致命的质疑", "聚焦可证伪性"],
  rebuttal: ["用数据回应最强质疑", "区分「已回应」与「已解决」"],
  synthesis: ["给出更保守的结论与置信区间"],
  prd: ["补充安全性约束", "补充 GDPR / 隐私合规验收标准", "拆分里程碑并给出验收标准"],
  "ui-code": ["补充无障碍（a11y）要求", "补充响应式断点"],
};

/** 该 Agent 的预设指令（角色专属 + 通用，去重） */
export function presetsForAgent(agentId?: string): string[] {
  const specific = agentId ? AGENT_PRESETS[agentId] ?? [] : [];
  return [...new Set([...specific, ...GENERIC_PRESETS])];
}

export interface NodeInterventionModalProps {
  open: boolean;
  node: ThoughtTreeNode | null;
  /** 点「重新推理此分支」触发；可为异步（期间显示「重算中…」） */
  onSubmit: (instruction: string) => void | Promise<void>;
  onClose: () => void;
  /** 覆盖预设指令（缺省按节点 Agent 角色推导） */
  presets?: string[];
}

export function NodeInterventionModal({
  open,
  node,
  onSubmit,
  onClose,
  presets,
}: NodeInterventionModalProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  if (!open || !node) return null;

  const options = presets ?? presetsForAgent(node.agentId);
  const agentName =
    AGENT_DISPLAY[node.agentId ?? ""] ?? node.agentLabel ?? node.agentId ?? "未标注";
  const canSubmit = text.trim().length > 0 && !pending;

  function handleClose() {
    if (pending) return;
    setText("");
    onClose();
  }

  async function handleSubmit() {
    const instruction = text.trim();
    if (!instruction || pending) return;
    setPending(true);
    try {
      await onSubmit(instruction);
      setText("");
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      data-node-intervention-modal
      role="dialog"
      aria-modal="true"
      aria-label="修正 / 干预此步骤"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">修正 / 干预此步骤 (Intervene)</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          节点：<span className="font-medium">{node.title}</span> · {agentName}
        </p>

        <div className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            快捷预设
          </span>
          <div className="flex flex-wrap gap-1.5">
            {options.map((preset) => (
              <button
                key={preset}
                type="button"
                data-intervention-preset={preset}
                onClick={() => setText(preset)}
                className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs text-gray-600 transition hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            针对「{agentName}」的修改建议
          </span>
          <textarea
            data-intervention-input
            value={text}
            rows={3}
            onChange={(event) => setText(event.target.value)}
            placeholder="例如：补充安全性约束 / 补充 GDPR 验收标准"
            className="w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-intervention-cancel
            onClick={handleClose}
            disabled={pending}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition disabled:opacity-40 dark:border-gray-700 dark:text-gray-200"
          >
            取消
          </button>
          <button
            type="button"
            data-intervention-submit
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {pending ? "重算中…" : "重新推理此分支"}
          </button>
        </div>
      </div>
    </div>
  );
}
