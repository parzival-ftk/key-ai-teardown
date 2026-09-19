import type { GenerationResult } from "@/lib/image/provider";
import type { GeneratedAsset } from "./types";

/**
 * 生成服务客户端（阶段 15，spec §13/§14）。
 *
 * 组件层通过这里发起生成：Component → Generation Request → `/api/generate`
 * → ComfyUIProvider → GenerationResult → GeneratedAsset（绑定来源组件）。
 *
 * 组件层**不接触** ComfyUI 的任何 HTTP 细节；失败以结构化结果返回（不抛错），
 * 让 UI 能显示 `code + message`。
 */

export const GENERATE_ENDPOINT = "/api/generate";

export interface GenerationInput {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  checkpoint?: string;
}

/** 构造请求体：只带真正提供的字段，避免把 undefined 写成 JSON null */
export function buildGenerationPayload(input: GenerationInput): Record<string, unknown> {
  const payload: Record<string, unknown> = { prompt: input.prompt };
  for (const key of ["negativePrompt", "width", "height", "seed", "steps", "cfg", "checkpoint"] as const) {
    const value = input[key];
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

/** 生成结果 → 绑定来源组件的资产（可追溯「这张图属于哪个组件」） */
export function assetFromResult(
  result: GenerationResult,
  componentId: string,
  createdAt: string,
): GeneratedAsset {
  return {
    id: result.id,
    componentId,
    provider: result.provider,
    prompt: result.prompt,
    artifactPath: result.artifactPath,
    url: result.url,
    width: result.width,
    height: result.height,
    createdAt,
  };
}

export type GenerationOutcome =
  | { ok: true; asset: GeneratedAsset }
  | { ok: false; error: string; code?: string };

interface GenerateResponseBody {
  ok?: boolean;
  error?: string;
  code?: string;
  result?: GenerationResult;
}

export interface RequestGenerationOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 发起一次生成；任何失败都归结为 { ok:false, error, code? } */
export async function requestGeneration(
  componentId: string,
  input: GenerationInput,
  options: RequestGenerationOptions = {},
): Promise<GenerationOutcome> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: "当前环境没有 fetch" };
  const now = options.now ?? (() => Date.now());

  let response: Response;
  try {
    response = await fetchImpl(GENERATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildGenerationPayload(input)),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "生成请求失败" };
  }

  let data: GenerateResponseBody | null = null;
  try {
    data = (await response.json()) as GenerateResponseBody;
  } catch {
    data = null;
  }

  if (!response.ok || !data?.ok || !data.result) {
    return {
      ok: false,
      error: data?.error ?? `生成失败（HTTP ${response.status}）`,
      ...(data?.code ? { code: data.code } : {}),
    };
  }

  return {
    ok: true,
    asset: assetFromResult(data.result, componentId, new Date(now()).toISOString()),
  };
}
