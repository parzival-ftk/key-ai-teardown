import { NextRequest, NextResponse } from "next/server";
import { parseUrl } from "@/lib/parsers/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/parse —— 输入解析（Wave 4）。
 * 当前支持 url（抓取+正文提取）与 text（直通）；
 * screenshot / pdf 通道将在后续补入。
 */
export async function POST(req: NextRequest) {
  let body: { type?: string; url?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  switch (body.type) {
    case "url": {
      if (!body.url) {
        return NextResponse.json({ error: "缺少 url 字段" }, { status: 400 });
      }
      const result = await parseUrl(body.url);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error ?? "抓取失败" },
          { status: 422 },
        );
      }
      return NextResponse.json(result);
    }

    case "text": {
      return NextResponse.json({
        url: "",
        title: "",
        text: (body.text ?? "").trim(),
        ok: true,
      });
    }

    default:
      return NextResponse.json(
        { error: `不支持的 type：${body.type ?? "(空)"}` },
        { status: 400 },
      );
  }
}
