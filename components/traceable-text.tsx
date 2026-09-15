"use client";

import type { ReactNode } from "react";
import {
  criticAnchorId,
  prdAnchorId,
  type TraceabilityReport,
} from "@/lib/report/traceability";

/**
 * 可追溯文本渲染（W15）—— 质疑列表与 PRD 正文里的 `[Cn]` 标记。
 *
 * 两处都要能「点一下跳到对面」：
 * - 质疑条目 → 跳 PRD 里引用它的位置（`prd-ref-c1`）
 * - PRD 的 [C1] 标记 → 跳回质疑条目（`critic-c1`）
 * 跳转与脉冲高亮由父组件统一处理（`onJump` + `pulseTarget`），本文件只负责渲染锚点。
 */

/** 行首编号（与 lib/report/traceability 的解析规则保持一致） */
const CRITIC_LINE =
  /^\s*(?:[-*+]\s*|\d+[.)]\s*)?\*{0,2}\[?(C\d+)\]?\*{0,2}\s*[.、:：)）]\s*(.+)$/i;

const PRD_REFERENCE = /\[(C\d+)\]/gi;

export interface TraceableTextProps {
  /** 跳到指定 DOM id（并在目标上触发脉冲高亮） */
  onJump: (domId: string) => void;
  /** 当前正在脉冲高亮的 DOM id */
  pulseTarget: string | null;
}

const pulseClass = (domId: string, pulseTarget: string | null) =>
  pulseTarget === domId ? "key-pulse" : "";

/**
 * 质疑列表：编号条目渲染成可点击行（点击跳到 PRD 对应位置），并标注是否已被 PRD 回应。
 * 非编号行（小标题 / 说明）按普通文本渲染。
 */
export function CriticList({
  text,
  traceability,
  onJump,
  pulseTarget,
}: { text: string; traceability: TraceabilityReport } & TraceableTextProps) {
  const linkById = new Map(traceability.links.map((l) => [l.criticId, l]));
  const lines = text.split(/\r?\n/);

  return (
    <div data-critic-list className="flex flex-col gap-1.5">
      {traceability.total > 0 && (
        <p
          data-trace-summary
          className="rounded-lg bg-gray-50 px-2 py-1 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400"
        >
          质疑回应情况：已回应 {traceability.addressed}/{traceability.total}
          {traceability.unaddressed.length > 0
            ? ` · 未回应 ${traceability.unaddressed.join("、")}`
            : " · 全部已回应"}
        </p>
      )}
      {lines.map((line, index) => {
        const match = CRITIC_LINE.exec(line);
        if (!match) {
          return (
            <p
              key={`plain-${index}`}
              className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300"
            >
              {line}
            </p>
          );
        }

        const criticId = match[1].toUpperCase();
        const domId = criticAnchorId(criticId);
        const addressed = linkById.get(criticId)?.addressed ?? false;

        return (
          <div
            key={criticId}
            id={domId}
            data-critic-item={criticId}
            data-critic-addressed={addressed ? "true" : "false"}
            className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition ${pulseClass(
              domId,
              pulseTarget,
            )} ${
              addressed
                ? "border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/40"
                : "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40"
            }`}
          >
            <button
              type="button"
              data-critic-jump={criticId}
              onClick={() => onJump(prdAnchorId(criticId))}
              title={addressed ? "跳到 PRD 中回应它的位置" : "PRD 尚未回应"}
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] transition ${
                addressed
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-amber-500 text-white hover:bg-amber-600"
              }`}
            >
              {criticId}
            </button>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300">
                {match[2]}
              </span>
              <span
                data-critic-status
                className={`text-[11px] ${
                  addressed
                    ? "text-green-700 dark:text-green-400"
                    : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {addressed ? "PRD 已回应" : "PRD 未回应"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * PRD 正文：把 `[C1]` 标记渲染成可点击锚点（点击跳回质疑条目）；
 * 其余文本原样呈现（保留换行）。
 */
export function PrdText({
  text,
  onJump,
  pulseTarget,
}: { text: string } & TraceableTextProps) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PRD_REFERENCE)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));

    const criticId = match[1].toUpperCase();
    const domId = prdAnchorId(criticId);
    parts.push(
      <button
        key={`${criticId}-${index}`}
        type="button"
        id={domId}
        data-prd-ref={criticId}
        onClick={() => onJump(criticAnchorId(criticId))}
        title={`跳回质疑 ${criticId}`}
        className={`mx-0.5 rounded px-1 py-0.5 align-baseline font-mono text-[11px] transition ${pulseClass(
          domId,
          pulseTarget,
        )} bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200`}
      >
        [{criticId}]
      </button>,
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <p
      data-prd-text
      className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300"
    >
      {parts}
    </p>
  );
}
