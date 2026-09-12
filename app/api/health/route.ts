import { NextResponse } from "next/server";
import { createProviderFromEnv } from "@/lib/config";
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
    const isLLM = err instanceof LLMError;
    const message = isLLM
      ? err.message
      : err instanceof Error
        ? err.message
        : "未知错误";
    // 未配置 → 400（用户可修正）；上游失败 → 502
    const status = isLLM && err.status ? 502 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
