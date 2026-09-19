import { NextRequest, NextResponse } from "next/server";
import { createComfyUIProviderFromEnv } from "@/lib/image/comfyui-provider";
import { handleGenerateRequest } from "@/lib/components/generation-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/generate —— 组件视觉生成的**服务端边界**（阶段 15，spec §13/§14）。
 *
 * 组件 → Generation Request → ImageGeneration Service → ComfyUIProvider → ComfyUI。
 * 路由保持极薄：解析 JSON → 委托给 `handleGenerateRequest` → 回传。
 * 所有 ComfyUI 细节（/prompt /history /view / class_type）都在 provider 里，路由看不见。
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { status, body: payload } = await handleGenerateRequest(body, createComfyUIProviderFromEnv());
  return NextResponse.json(payload, { status });
}
