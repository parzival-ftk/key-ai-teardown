"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * 7 段式报告骨架（借鉴 ArdaGoksuGuner/Competitor-Analysis，见设计规格 E1）。
 * Wave 1 仅「竞品分析师」上线，其输出填入「市场格局」，其余段落标注待补充。
 */
const SECTIONS = [
  { key: "summary", title: "执行摘要", owner: "PM 综合官" },
  { key: "landscape", title: "市场格局", owner: "竞品分析师" },
  { key: "competitors", title: "竞品画像", owner: "竞品分析师" },
  { key: "strengths", title: "竞品优势", owner: "竞品分析师" },
  { key: "gaps", title: "空白与机会", owner: "PM 综合官" },
  { key: "threats", title: "值得警惕的威胁", owner: "反方质疑官" },
  { key: "recommendations", title: "建议", owner: "PM 综合官" },
] as const;

interface ReportSection {
  agentId: string;
  name: string;
  status: string;
  output: string;
}

interface ReportData {
  name?: string;
  sections: ReportSection[];
}

export function ReportView({ id }: { id: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(`report:${id}`);
    } catch {
      raw = null;
    }
    if (!raw) {
      setMissing(true);
      return;
    }
    try {
      setData(JSON.parse(raw));
    } catch {
      setMissing(true);
    }
  }, [id]);

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

  const landscape = data.sections.find((s) => s.agentId === "market");
  const contentByKey: Record<string, string | undefined> = {
    landscape: landscape?.output,
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          {data.name || "产品"} · 拆解报告
        </h1>
        <p className="text-sm text-gray-400">
          共 {SECTIONS.length} 段 · 当前已生成
          {data.sections.filter((s) => s.output).length} 段
        </p>
      </header>

      {SECTIONS.map((section, i) => {
        const content = contentByKey[section.key];
        return (
          <section
            key={section.key}
            className="rounded-xl border border-gray-200 p-5 dark:border-gray-800"
          >
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
              <span className="text-sm text-gray-400">{i + 1}.</span>
              {section.title}
            </h2>
            {content ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {content}
              </p>
            ) : (
              <p className="text-sm text-gray-400">
                待补充 —— 由「{section.owner}」负责（后续 Wave 接入）。
              </p>
            )}
          </section>
        );
      })}
    </main>
  );
}
