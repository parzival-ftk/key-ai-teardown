import { NextRequest, NextResponse } from "next/server";
import { reportToMarkdown } from "@/lib/export/report-markdown";
import type { Evidence } from "@/lib/types/evidence";
import {
  parseUserStories,
  buildIssues,
  issuesToMarkdown,
  issuesToJson,
} from "@/lib/export/github-issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/export —— 报告导出（Wave 5.5）。
 * format=markdown（默认）→ 整份报告 Markdown；
 * format=issues → PRD 用户故事转 GitHub Issues（Markdown）；
 * format=issues-json → 同上，JSON。
 *
 * 返回文本内容，由前端决定下载文件名（Blob 下载）。
 */

interface ExportBody {
  name?: string;
  sections?: {
    agentId: string;
    name?: string;
    output: string;
    /** 证据标签（W2 起由前端随 sections 一并 POST，透传给 Markdown 导出） */
    evidence?: Evidence[];
  }[];
  format?: "markdown" | "issues" | "issues-json";
}

export async function POST(req: NextRequest) {
  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const sections = Array.isArray(body.sections) ? body.sections : [];
  const format = body.format ?? "markdown";

  if (format === "issues" || format === "issues-json") {
    const prd = sections.find((s) => s.agentId === "prd");
    const stories = parseUserStories(prd?.output ?? "");
    const issues = buildIssues(stories);
    if (format === "issues-json") {
      return new NextResponse(issuesToJson(issues), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new NextResponse(issuesToMarkdown(issues), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  const markdown = reportToMarkdown({ name: body.name, sections });
  return new NextResponse(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
