"use client";

import { useState } from "react";
import type {
  RedTeamFindingKind,
  RedTeamReport,
} from "@/lib/eval/redTeaming";

/**
 * 红队防幻觉徽章（W16）—— 在质量看板里显式呈现拦截状态、矛盾点与降级日志。
 *
 * 呈现原则：**拦截必须可见**。被强制降级的结论要能说清「哪一条、从什么降成什么、为什么」，
 * 否则「防幻觉」就只是一个好看的徽章。
 */

const KIND_META: Record<
  RedTeamFindingKind,
  { label: string; hint: string; cls: string }
> = {
  fabricated_citation: {
    label: "虚构引用",
    hint: "「已核实」无法追溯回本次输入",
    cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  unsupported_metric: {
    label: "虚构数值",
    hint: "报出具体数字却没有任何来源",
    cls: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  contradiction: {
    label: "矛盾事实",
    hint: "同一指标在不同段落给出不同数值",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
};

export interface RedTeamingBadgeProps {
  report: RedTeamReport;
  /** 默认展开拦截明细（看板内嵌时用，避免套两层折叠） */
  defaultOpen?: boolean;
}

export function RedTeamingBadge({
  report,
  defaultOpen = false,
}: RedTeamingBadgeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const blocked = report.blockedCount;
  const hasFindings = report.findings.length > 0;

  return (
    <section
      data-red-teaming
      data-red-team-blocked={blocked}
      data-red-team-findings={report.findings.length}
      className={`rounded-lg border p-2.5 text-xs ${
        blocked > 0
          ? "border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40"
          : "border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-700 dark:text-gray-200">
          红队防幻觉
        </span>
        <span
          data-red-team-status
          className={`rounded-full px-2 py-0.5 font-semibold ${
            blocked > 0
              ? "bg-red-600 text-white"
              : "bg-green-600 text-white"
          }`}
        >
          {blocked > 0 ? `拦截 ${blocked} 条` : "未发现异常"}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {blocked > 0
            ? "以下结论已被强制降级（虚构/无据 → 推测；矛盾/无法核实 → 缺失）"
            : "未发现虚构引用、虚构数值或跨段矛盾"}
        </span>
        {hasFindings && (
          <button
            type="button"
            data-red-team-toggle
            onClick={() => setOpen((v) => !v)}
            className="ml-auto shrink-0 rounded border border-gray-300 px-2 py-0.5 text-gray-600 transition hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
          >
            {open ? "收起拦截明细 ▲" : "查看拦截明细 ▼"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <ul className="flex flex-col gap-1">
            {report.findings.map((finding, index) => {
              const meta = KIND_META[finding.kind];
              return (
                <li
                  key={`${finding.kind}-${index}`}
                  data-red-team-finding={finding.kind}
                  className="flex flex-wrap items-start gap-1.5"
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                  <span className="text-gray-600 dark:text-gray-300">
                    {finding.detail}
                  </span>
                  <span className="text-gray-400">
                    （{finding.severity === "blocked" ? "已拦截" : "仅记录"}）
                  </span>
                </li>
              );
            })}
          </ul>

          {report.downgrades.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="font-medium tracking-wide text-gray-400">
                降级日志（{report.downgrades.length}）
              </span>
              <ul className="flex flex-col gap-1">
                {report.downgrades.map((d, index) => (
                  <li
                    key={`${d.sectionId}-${d.evidenceIndex}-${index}`}
                    data-red-team-downgrade={`${d.sectionId}#${d.evidenceIndex}`}
                    className="rounded border border-gray-200 bg-white/70 px-2 py-1 text-gray-600 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300"
                  >
                    <code className="font-mono text-[10px] text-gray-400">
                      {d.sectionId}
                    </code>{" "}
                    <span className="font-medium">{d.claim}</span>
                    <span className="mx-1 text-gray-400">
                      {d.from} → {d.to}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {d.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
