import { NextRequest, NextResponse } from "next/server";
import { parseUrl } from "@/lib/parsers/url";
import { parsePdf } from "@/lib/parsers/pdf";
import { parseImageDataUrl } from "@/lib/parsers/image";
import { renderUiStructure, summarizeUiStructure } from "@/lib/parsers/dom";
import { parseDiagramFromImage } from "@/lib/diagram/vision-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/parse —— 输入解析（Wave 4）。
 *
 * 五条输入通道：
 * - text       直通（原样回显，供统一入口）
 * - url        抓取 + 正文提取
 * - pdf        base64 解码 + 文本抽取
 * - screenshot 图片 data URL 校验（图片本身在分析时随 brief 交给 Vision 模型）
 * - diagram    架构图截图 → mermaid 代码（W25；无 Key 时走确定性 Stub）
 */

interface ParseBody {
  type?: string;
  url?: string;
  text?: string;
  /** screenshot / diagram：图片 data URL */
  dataUrl?: string;
  /** pdf：base64（可带 data URL 前缀） */
  dataBase64?: string;
  /** diagram：图片 MIME（dataUrl 已带前缀时可省略） */
  mimeType?: string;
  /** diagram：图形类型提示，如 "flowchart" / "state" */
  diagramTypeHint?: string;
}

/** 从 data URL 或裸 base64 中取出 base64 段；非法返回 null */
function extractBase64(raw: string): string | null {
  const trimmed = raw.trim();
  const dataUrlMatch = /^data:([^;,]*);base64,([\s\S]+)$/i.exec(trimmed);
  if (dataUrlMatch) return dataUrlMatch[2].replace(/\s+/g, "");

  const bare = trimmed.replace(/\s+/g, "");
  if (bare && /^[A-Za-z0-9+/]+={0,2}$/.test(bare)) return bare;
  return null;
}

export async function POST(req: NextRequest) {
  let body: ParseBody;
  try {
    body = (await req.json()) as ParseBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  switch (body.type) {
    case "url": {
      if (!body.url) {
        return NextResponse.json({ error: "缺少 url 字段" }, { status: 400 });
      }
      const result = await parseUrl(body.url);

      // W8：尝试无头渲染取「DOM + computed styles」。拿不到浏览器 / 渲染失败一律降级，
      // 不让它影响文本抓取的结果（单点失败不阻塞）。
      let uiStructure: string | undefined;
      try {
        const structure = await renderUiStructure(body.url);
        uiStructure = summarizeUiStructure(structure);
      } catch {
        uiStructure = undefined;
      }

      // 文本抓取失败、但无头渲染成功（典型：纯 JS 渲染页）→ 仍可用结构继续分析
      if (!result.ok && !uiStructure) {
        return NextResponse.json(
          { error: result.error ?? "抓取失败" },
          { status: 422 },
        );
      }
      return NextResponse.json({
        ...result,
        ok: true,
        text: result.ok ? result.text : "",
        uiStructure,
      });
    }

    case "pdf": {
      const raw = body.dataBase64 ?? "";
      if (!raw) {
        return NextResponse.json(
          { error: "缺少 dataBase64 字段" },
          { status: 400 },
        );
      }
      const b64 = extractBase64(raw);
      if (!b64) {
        return NextResponse.json(
          { error: "dataBase64 不是合法的 base64" },
          { status: 400 },
        );
      }
      const result = await parsePdf(Buffer.from(b64, "base64"));
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error ?? "PDF 解析失败" },
          { status: 422 },
        );
      }
      return NextResponse.json({
        text: result.text,
        pages: result.pages,
        ok: true,
      });
    }

    case "screenshot": {
      const result = parseImageDataUrl(body.dataUrl ?? "");
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error ?? "图片不合法" },
          { status: 422 },
        );
      }
      return NextResponse.json({
        ok: true,
        dataUrl: result.dataUrl,
        mimeType: result.mimeType,
        bytes: result.bytes,
      });
    }

    case "text": {
      return NextResponse.json({
        url: "",
        title: "",
        text: (body.text ?? "").trim(),
        ok: true,
      });
    }

    case "diagram": {
      // W25：架构图截图 → mermaid。引擎**永不抛错**：无 Key 走确定性 Stub、
      // 非法输入/调用异常降级为安全默认结构并置 ok:false + error，
      // 因此这里固定 200（与其它通道「解析失败即 422」不同，是本通道的契约）。
      const result = await parseDiagramFromImage({
        imageBase64: body.dataUrl ?? body.dataBase64 ?? "",
        mimeType: body.mimeType ?? "",
        diagramTypeHint: body.diagramTypeHint,
      });
      return NextResponse.json({
        ok: result.source !== "fallback",
        code: result.code,
        diagramType: result.diagramType,
        confidenceScore: result.confidenceScore,
        detectedNodesCount: result.detectedNodesCount,
        source: result.source,
        error: result.error,
      });
    }

    default:
      return NextResponse.json(
        { error: `不支持的 type：${body.type ?? "(空)"}` },
        { status: 400 },
      );
  }
}
