import { NextResponse } from "next/server";
import { createProviderFromEnv, LLMConfigError } from "@/lib/config";
import { LLMError } from "@/lib/llm/provider";

export const runtime = "nodejs";

/**
 * 连通性探针 —— Wave 0 出口（H3：验证 OpenAI 兼容协议能覆盖目标厂商）。
 * GET /api/health → 用环境变量里的配置发一次最小请求。
 */
export async function GET() {
  try {
    const provider = createProviderFromEnv();
    const result = await provider.chat(
      [
        { role: "system", content: "你是连通性测试。只回复两个字：正常。" },
        { role: "user", content: "ping" },
      ],
      { maxTokens: 16, temperature: 0 },
    );
    return NextResponse.json({
      ok: true,
      model: result.model,
      reply: result.content,
      usage: result.usage,
    });
  } catch (err) {
    // 配置缺失 → 400（用户可修正）；上游错误状态 → 502；超时/网络异常 → 503；其它 → 500
    if (err instanceof LLMConfigError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 400 },
      );
    }
    if (err instanceof LLMError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status ? 502 : 503 },
      );
    }
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
