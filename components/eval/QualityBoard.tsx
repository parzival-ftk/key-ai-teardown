"use client";

import { useMemo, useState } from "react";
import {
  scoreEvaluation,
  type EvaluableReport,
  type EvaluationSuggestion,
} from "@/lib/eval/judgeAgent";
import { DEFAULT_GATE_THRESHOLD } from "@/lib/eval/dimensions";

/**
 * 质量与可信度评估看板（W14）。
 *
 * 数据来自**启发式评分**（`scoreEvaluation`，无 LLM、确定性、零成本）——
 * 报告页不该为了打个分再花一次 LLM 调用；LLM-as-a-judge 留给离线 `npm run eval`。
 *
 * 交互：轻量展开 / 收起，默认收起，只露综合分徽章与一行摘要。
 */

function toneOf(score: number) {
  if (score >= 80) {
    return {
      bar: "bg-green-500",
      badge:
        "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
      text: "text-green-700 dark:text-green-300",
    };
  }
  if (score >= 60) {
    return {
      bar: "bg-amber-500",
      badge:
        "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
      text: "text-amber-700 dark:text-amber-300",
    };
  }
  return {
    bar: "bg-red-500",
    badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    text: "text-red-700 dark:text-red-300",
  };
}

const SEVERITY_META: Record<EvaluationSuggestion["severity"], { label: string; cls: string }> = {
  critical: {
    label: "必须修",
    cls: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
  warn: {
    label: "建议改",
    cls: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
  hint: {
    label: "可选",
    cls: "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300",
  },
};

export interface QualityBoardProps {
  report: EvaluableReport;
  /** 默认展开（测试与演示用） */
  defaultOpen?: boolean;
  /** 门禁阈值（默认 80） */
  threshold?: number;
}

export function QualityBoard({
  report,
  defaultOpen = false,
  threshold = DEFAULT_GATE_THRESHOLD,
}: QualityBoardProps) {
  const evaluation = useMemo(
    () => scoreEvaluation(report, { threshold }),
    [report, threshold],
  );
  const [open, setOpen] = useState(defaultOpen);
  const tone = toneOf(evaluation.composite);
  const primaryHighlight =
    evaluation.highlights[0]?.text ?? "尚未产生可评估内容";

  return (
    <section
      data-quality-board
      data-quality-composite={evaluation.composite}
      data-quality-open={open ? "true" : "false"}
      className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        data-quality-toggle
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="text-sm font-medium">质量与可信度评估</span>
        <span
          data-quality-badge
          className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone.badge}`}
        >
          {evaluation.composite}
          <span className="font-normal opacity-70"> /100</span>
        </span>
        <span className="hidden truncate text-xs text-gray-500 sm:inline dark:text-gray-400">
          {primaryHighlight}
        </span>
        <span className="ml-auto shrink-0 text-xs text-gray-400">
          {open ? "收起 ▲" : "展开 ▼"}
        </span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-gray-400">
            启发式评分（不消耗模型调用）· 门禁阈值 {threshold} 分 ·{" "}
            {evaluation.gate.passed ? "已达标" : "未达标"}
          </p>

          <ul className="flex flex-col gap-2.5">
            {evaluation.dimensions.map((dim) => {
              const dimTone = toneOf(dim.score);
              return (
                <li
                  key={dim.id}
                  data-quality-dimension={dim.id}
                  className="flex flex-col gap-1"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {dim.name}
                    </span>
                    <span className="tabular-nums text-gray-500 dark:text-gray-400">
                      {dim.score}
                    </span>
                    {dim.downgraded && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">
                        已降级
                      </span>
                    )}
                    <span className="ml-auto text-gray-400">{dim.nameEn}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                    <div
                      className={`h-full rounded-full ${dimTone.bar}`}
                      style={{ width: `${dim.score}%` }}
                    />
                  </div>
                  {/* 显式提示点，例如：证据追溯度 95%：所有核心结论均已核验 */}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {dim.name} {dim.score} 分：{dim.note}
                  </p>
                </li>
              );
            })}
          </ul>

          {evaluation.highlights.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
              {evaluation.highlights.map((h) => (
                <li
                  key={`${h.kind}-${h.dimension}`}
                  className={
                    h.kind === "strength"
                      ? "text-green-700 dark:text-green-300"
                      : "text-amber-700 dark:text-amber-300"
                  }
                >
                  {h.kind === "strength" ? "亮点：" : "短板："}
                  {h.text}
                </li>
              ))}
            </ul>
          )}

          {evaluation.suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium tracking-wide text-gray-400">
                降级建议
              </span>
              <ul className="flex flex-col gap-1.5">
                {evaluation.suggestions.map((s, i) => {
                  const meta = SEVERITY_META[s.severity];
                  return (
                    <li
                      key={`${s.dimension}-${i}`}
                      data-quality-suggestion={s.severity}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs ${meta.cls}`}
                    >
                      <span className="mr-1.5 font-medium">[{meta.label}]</span>
                      {s.text}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
