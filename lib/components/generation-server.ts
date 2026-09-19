import { ImageGenError, type ImageGenerationProvider } from "@/lib/image/provider";

/**
 * 生成请求的服务端核心（阶段 15，spec §13）。
 *
 * 从 Next 路由里抽出来，目的有二：
 *   ① 让「请求体校验 → 调 provider → 错误码 → HTTP 状态」这条逻辑可单测
 *      （注入假 provider，不必真连 ComfyUI）；
 *   ② 让路由文件保持极薄：只做 JSON 解析与委托。
 *
 * 边界纪律：画布/组件层永不直接 fetch `/prompt` —— 真正的后端概念只在
 * `ImageGenerationProvider` 实现里出现。
 */

export interface GenerateRequestBody {
  prompt?: unknown;
  negativePrompt?: unknown;
  width?: unknown;
  height?: unknown;
  steps?: unknown;
  cfg?: unknown;
  seed?: unknown;
  sampler?: unknown;
  scheduler?: unknown;
  checkpoint?: unknown;
  filenamePrefix?: unknown;
}

export interface ServiceResult {
  status: number;
  body: unknown;
}

/** 失败阶段 → HTTP 状态码：配置错在用户侧(400)，实例不可达(503)，其余上游错(502)，非法 workflow(422) */
export function statusForImageGenCode(code: ImageGenError["code"]): number {
  switch (code) {
    case "CONFIG_ERROR":
      return 400;
    case "WORKFLOW_INVALID":
      return 422;
    case "COMFYUI_UNAVAILABLE":
      return 503;
    default:
      return 502;
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** 处理一次生成请求（纯逻辑，provider 注入） */
export async function handleGenerateRequest(
  rawBody: unknown,
  provider: ImageGenerationProvider,
): Promise<ServiceResult> {
  if (!rawBody || typeof rawBody !== "object") {
    return { status: 400, body: { ok: false, error: "请求体必须是 JSON 对象" } };
  }
  const body = rawBody as GenerateRequestBody;
  const prompt = stringOrUndefined(body.prompt);
  if (!prompt) {
    return { status: 400, body: { ok: false, error: "缺少 prompt（要生成什么）" } };
  }

  try {
    const result = await provider.generate({
      prompt,
      ...(stringOrUndefined(body.negativePrompt) ? { negativePrompt: body.negativePrompt as string } : {}),
      ...(numberOrUndefined(body.width) !== undefined ? { width: body.width as number } : {}),
      ...(numberOrUndefined(body.height) !== undefined ? { height: body.height as number } : {}),
      ...(numberOrUndefined(body.steps) !== undefined ? { steps: body.steps as number } : {}),
      ...(numberOrUndefined(body.cfg) !== undefined ? { cfg: body.cfg as number } : {}),
      ...(numberOrUndefined(body.seed) !== undefined ? { seed: body.seed as number } : {}),
      ...(stringOrUndefined(body.sampler) ? { sampler: body.sampler as string } : {}),
      ...(stringOrUndefined(body.scheduler) ? { scheduler: body.scheduler as string } : {}),
      ...(stringOrUndefined(body.checkpoint) ? { checkpoint: body.checkpoint as string } : {}),
      ...(stringOrUndefined(body.filenamePrefix) ? { filenamePrefix: body.filenamePrefix as string } : {}),
    });
    return { status: 200, body: { ok: true, result } };
  } catch (error) {
    if (error instanceof ImageGenError) {
      return {
        status: statusForImageGenCode(error.code),
        body: { ok: false, code: error.code, error: error.message },
      };
    }
    const message = error instanceof Error ? error.message : "生成失败";
    return { status: 500, body: { ok: false, error: message } };
  }
}
