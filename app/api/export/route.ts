import { NextRequest, NextResponse } from "next/server";
import { reportToMarkdown } from "@/lib/export/report-markdown";
import { htmlToFigmaDocument, figmaDocumentToJson } from "@/lib/export/figma-exporter";
import {
  mermaidStateToXState,
  xstateConfigToJson,
  xstateConfigToTypeScript,
} from "@/lib/export/xstate-exporter";
import { extractCodeBlocks } from "@/lib/report/code-blocks";
import { extractMermaidBlocks } from "@/lib/diagram/mermaid-blocks";
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
 * POST /api/export —— 报告导出（Wave 5.5；W17 加 Figma；W18 加 XState）。
 * format=markdown（默认）→ 整份报告 Markdown；
 * format=issues → PRD 用户故事转 GitHub Issues（Markdown）；
 * format=issues-json → 同上，JSON；
 * format=figma → 界面代码（HTML+Tailwind）转 Figma Node JSON（W17）；
 * format=xstate → PRD 状态图（Mermaid stateDiagram-v2）转 XState v5 机器配置 JSON（W18）；
 * format=xstate-ts → 同上，TypeScript 源码。
 *
 * 返回文本内容，由前端决定下载文件名（Blob 下载）。
 * 转换引擎都是纯函数：figma 依赖 cheerio（故只在 server 跑，避免进 client bundle）；
 * xstate 零依赖（同构），此处提供 server 出口，客户端也可直接调用以获得即时预览。
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
  /** format=figma 时可直接提供 HTML 片段（界面代码预览组件手上即持有该串） */
  html?: string;
  /** format=xstate 时可直接提供 Mermaid 状态图源码（图谱组件手上即持有该串） */
  code?: string;
  /** format=xstate：机器 id（缺省 machine） */
  machineId?: string;
  format?:
    | "markdown"
    | "issues"
    | "issues-json"
    | "figma"
    | "xstate"
    | "xstate-ts";
}

/**
 * 从 sections 里定位第一个状态图（Mermaid stateDiagram-v2）源码。
 * 供报告页导出按钮用它（此时前端只送 sections，不单独送 code）。
 */
function extractStateDiagramFromSections(
  sections: NonNullable<ExportBody["sections"]>,
): string {
  for (const section of sections) {
    const block = extractMermaidBlocks(section.output ?? "").find(
      (b) => b.kind === "state",
    );
    if (block) return block.code;
  }
  return "";
}

/**
 * 从 sections 里定位「界面代码」段的 HTML 代码块。
 * 供报告页顶部导出按钮用它（此时前端只送 sections，不单独送 html）。
 */
function extractHtmlFromSections(
  sections: NonNullable<ExportBody["sections"]>,
): string {
  const ui = sections.find((s) => s.agentId === "ui-code");
  if (!ui) return "";
  const block = extractCodeBlocks(ui.output ?? "").find((b) => b.lang === "html");
  return block?.code ?? "";
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

  if (format === "figma") {
    const html =
      typeof body.html === "string" ? body.html : extractHtmlFromSections(sections);
    const doc = htmlToFigmaDocument(html, { name: body.name });
    return new NextResponse(figmaDocumentToJson(doc), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  if (format === "xstate" || format === "xstate-ts") {
    const code =
      typeof body.code === "string"
        ? body.code
        : extractStateDiagramFromSections(sections);
    const { config, diagnostics } = mermaidStateToXState(code, {
      id: body.machineId,
    });
    if (format === "xstate-ts") {
      return new NextResponse(xstateConfigToTypeScript(config, diagnostics), {
        headers: { "Content-Type": "text/typescript; charset=utf-8" },
      });
    }
    return new NextResponse(xstateConfigToJson(config), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const markdown = reportToMarkdown({ name: body.name, sections });
  return new NextResponse(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
