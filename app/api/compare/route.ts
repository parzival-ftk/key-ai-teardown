import { NextRequest, NextResponse } from "next/server";
import { safeParseCompareBrief } from "@/lib/types/compare";
import { createComparisonStream } from "@/lib/compare/stream";
import { createProviderFromEnv } from "@/lib/config";
import { LLMError } from "@/lib/llm/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/compare —— 建立对比 SSE 流（W11）。
 * 参数非法（非 JSON / 产品数不在 2-3）→ 400；配置缺失 → 400；
 * 运行期错误 → 转为流内 error 事件（不中断）。
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = safeParseCompareBrief(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "输入校验失败", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  let provider;
  try {
    provider = createProviderFromEnv();
  } catch (err) {
    const message =
      err instanceof LLMError ? err.message : "LLM 配置缺失或非法";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const stream = createComparisonStream(parsed.data, {
    provider,
    signal: req.signal,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
