"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import { getReport } from "@/lib/history";
import { EVIDENCE_LABEL } from "@/lib/report/evidence-labels";
import {
  summarizeEvidence,
  evidenceTotal,
  traceablePercent,
  type Evidence,
  type EvidenceStats,
} from "@/lib/types/evidence";
import { EvidenceList } from "./evidence-list";
import { CodePanel } from "./code-panel";
import { CodePreview } from "./code-preview";
import { extractCodeBlocks, stripCodeBlocks } from "@/lib/report/code-blocks";

/**
 * 分段式报告（借鉴 ArdaGoksuGuner/Competitor-Analysis，见设计规格 E1）。
 * 章节顺序来自共享定义 lib/report/sections.ts，避免与导出模块漂移。
 */

export interface ReportSection {
  agentId: string;
  name: string;
  status: string;
  output: string;
  /** 模型自评置信度（W2）—— 旧报告可能缺省 */
  confidence?: number;
  /** 证据标签（W2）—— 旧报告可能缺省 */
  evidence?: Evidence[];
}

export interface ReportData {
  name?: string;
  sections: ReportSection[];
}

/** 触发浏览器下载（前端拿到导出文本后落盘） */
function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string | undefined): string {
  const base = (name ?? "report").trim() || "report";
  return base.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 40);
}

export function ReportView({
  id,
  initialData,
}: {
  id: string;
  /** 直接注入报告数据（样例回放等）；提供时跳过存储加载 */
  initialData?: ReportData;
}) {
  const [data, setData] = useState<ReportData | null>(initialData ?? null);
  const [missing, setMissing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) return;
    let parsed: ReportData | null = null;
    // 优先读持久化历史（localStorage），回退到当前会话（sessionStorage）
    try {
      parsed = getReport<ReportData>(localStorage, id);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      try {
        const raw = sessionStorage.getItem(`report:${id}`);
        if (raw) parsed = JSON.parse(raw) as ReportData;
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      setMissing(true);
      return;
    }
    setData(parsed);
  }, [id, initialData]);

  if (missing) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回首页
        </Link>
        <p className="text-sm text-gray-500">
          找不到这份报告（可能已刷新或会话过期）。请返回首页重新分析。
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-gray-400">加载中…</p>
      </main>
    );
  }

  const byAgent = (agentId: string) =>
    data.sections.find((s) => s.agentId === agentId);
  const generatedCount = data.sections.filter((s) => s.output).length;
  const overallStats: EvidenceStats = summarizeEvidence(
    data.sections.flatMap((s) => s.evidence ?? []),
  );
  const busy = exporting !== null;

  async function handleExport(format: "markdown" | "issues") {
    if (!data) return;
    setExporting(format);
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          sections: data.sections,
          format,
        }),
      });
      if (!res.ok) throw new Error(`导出失败：HTTP ${res.status}`);
      const text = await res.text();
      const base = safeFilename(data.name);
      if (format === "issues") {
        download(`${base}-prd-issues.md`, text, "text/markdown;charset=utf-8");
      } else {
        download(`${base}-报告.md`, text, "text/markdown;charset=utf-8");
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "导出失败，请重试");
    } finally {
      setExporting(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          {data.name || "产品"} · 拆解报告
        </h1>
        <p className="text-sm text-gray-400">
          共 {REPORT_SECTIONS.length} 段 · 当前已生成 {generatedCount} 段
        </p>

        {evidenceTotal(overallStats) > 0 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {traceablePercent(overallStats)}%
              </span>
              <span className="text-sm text-gray-500">可追溯输入</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              共 {evidenceTotal(overallStats)} 条结论 · {EVIDENCE_LABEL.verified}{" "}
              {overallStats.verified} · {EVIDENCE_LABEL.inferred}{" "}
              {overallStats.inferred} · {EVIDENCE_LABEL.missing}{" "}
              {overallStats.missing}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleExport("markdown")}
            disabled={busy}
            className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {exporting === "markdown" ? "导出中…" : "下载报告（Markdown）"}
          </button>
          <button
            type="button"
            onClick={() => handleExport("issues")}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:border-gray-500 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200"
          >
            {exporting === "issues" ? "导出中…" : "导出 PRD Issues"}
          </button>
        </div>
        {exportError && (
          <p className="text-sm text-red-600 dark:text-red-400">{exportError}</p>
        )}
      </header>

      {REPORT_SECTIONS.map((section, i) => {
        const sectionData = byAgent(section.agentId);
        const raw = sectionData?.output ?? "";
        // W6：把代码围栏从正文里剥出来，单独用可复制的代码面板展示
        const codeBlocks = raw ? extractCodeBlocks(raw) : [];
        const content = codeBlocks.length > 0 ? stripCodeBlocks(raw) : raw;
        return (
          <section
            key={section.key}
            className="key-fade-in-up rounded-xl border border-gray-200 p-5 dark:border-gray-800"
            style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}
          >
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
              <span className="text-sm text-gray-400">{i + 1}.</span>
              {section.title}
              {typeof sectionData?.confidence === "number" && (
                <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  置信度 {sectionData.confidence}
                </span>
              )}
            </h2>
            {content ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {content}
              </p>
            ) : codeBlocks.length === 0 ? (
              <p className="text-sm text-gray-400">
                待补充 —— 由「{section.owner}」负责。
              </p>
            ) : null}
            <CodePanel blocks={codeBlocks} />
            {codeBlocks[0] ? <CodePreview html={codeBlocks[0].code} /> : null}
            {/* 证据与正文独立渲染：正文为空但有证据时不应被连带丢弃（审查修复） */}
            <EvidenceList evidence={sectionData?.evidence ?? []} />
          </section>
        );
      })}
    </main>
  );
}
