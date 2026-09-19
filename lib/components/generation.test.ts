import { describe, it, expect } from "vitest";
import {
  assetFromResult,
  buildGenerationPayload,
  requestGeneration,
  GENERATE_ENDPOINT,
} from "./generation";
import { handleGenerateRequest, statusForImageGenCode } from "./generation-server";
import { ImageGenError, type ImageGenerationProvider, type GenerationResult } from "@/lib/image/provider";

const RESULT: GenerationResult = {
  id: "prompt-1",
  status: "succeeded",
  provider: "comfyui",
  prompt: "a cinematic city",
  seed: 7,
  checkpoint: "sd_xl_base_1.0.safetensors",
  width: 512,
  height: 512,
  steps: 20,
  cfg: 7.5,
  sampler: "euler",
  scheduler: "normal",
  filename: "key_00001_.png",
  mimeType: "image/png",
  bytes: 1234,
  artifactPath: ".rivet/artifacts/comfy/key_00001_.png",
  url: "http://127.0.0.1:8188/view?filename=key_00001_.png",
};

function fakeProvider(generate: () => Promise<GenerationResult>): ImageGenerationProvider {
  return { id: "fake", generate };
}

describe("buildGenerationPayload", () => {
  it("只带提供的字段（不把 undefined 写成 null）", () => {
    expect(buildGenerationPayload({ prompt: "x" })).toEqual({ prompt: "x" });
    expect(buildGenerationPayload({ prompt: "x", width: 512, seed: 0 })).toEqual({
      prompt: "x",
      width: 512,
      seed: 0,
    });
  });
});

describe("assetFromResult", () => {
  it("绑定来源组件并保留可追溯字段", () => {
    const asset = assetFromResult(RESULT, "n6", "2026-01-01T00:00:00.000Z");
    expect(asset).toMatchObject({
      id: "prompt-1",
      componentId: "n6",
      provider: "comfyui",
      prompt: "a cinematic city",
      artifactPath: RESULT.artifactPath,
      url: RESULT.url,
      width: 512,
      height: 512,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("requestGeneration（客户端）", () => {
  it("成功：返回绑定组件的资产", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: true, result: RESULT }), { status: 200 })) as unknown as typeof fetch;
    const outcome = await requestGeneration("n6", { prompt: "a cinematic city" }, {
      fetchImpl,
      now: () => 1_700_000_000_000,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.asset.componentId).toBe("n6");
      expect(outcome.asset.url).toBe(RESULT.url);
      expect(outcome.asset.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    }
  });

  it("失败：带出后端的 code 与 message", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ ok: false, code: "COMFYUI_UNAVAILABLE", error: "连不上 ComfyUI" }),
        { status: 503 },
      )) as unknown as typeof fetch;
    const outcome = await requestGeneration("n6", { prompt: "x" }, { fetchImpl });
    expect(outcome).toEqual({ ok: false, error: "连不上 ComfyUI", code: "COMFYUI_UNAVAILABLE" });
  });

  it("网络异常：返回结构化错误而非抛出", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const outcome = await requestGeneration("n6", { prompt: "x" }, { fetchImpl });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("network down");
  });

  it("请求体发往 /api/generate 且含 prompt", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ ok: true, result: RESULT }), { status: 200 });
    }) as unknown as typeof fetch;
    await requestGeneration("n6", { prompt: "hello", width: 768 }, { fetchImpl });
    expect(captured!.url).toBe(GENERATE_ENDPOINT);
    expect(captured!.body).toEqual({ prompt: "hello", width: 768 });
  });
});

describe("handleGenerateRequest（服务端核心）", () => {
  it("非对象请求体 → 400", async () => {
    const result = await handleGenerateRequest(null, fakeProvider(async () => RESULT));
    expect(result.status).toBe(400);
  });

  it("缺 prompt → 400", async () => {
    const result = await handleGenerateRequest({ prompt: "   " }, fakeProvider(async () => RESULT));
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toContain("prompt");
  });

  it("成功 → 200 且回传 result", async () => {
    const provider = fakeProvider(async () => RESULT);
    const result = await handleGenerateRequest({ prompt: "x", width: 512 }, provider);
    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean; result: GenerationResult }).result).toBe(RESULT);
  });

  it("ImageGenError 映射到正确状态码与 code", async () => {
    const provider = fakeProvider(async () => {
      throw new ImageGenError("COMFYUI_UNAVAILABLE", "连不上");
    });
    const result = await handleGenerateRequest({ prompt: "x" }, provider);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, code: "COMFYUI_UNAVAILABLE", error: "连不上" });
  });

  it("未知异常 → 500", async () => {
    const provider = fakeProvider(async () => {
      throw new Error("boom");
    });
    const result = await handleGenerateRequest({ prompt: "x" }, provider);
    expect(result.status).toBe(500);
  });

  it("错误码到状态码的映射表", () => {
    expect(statusForImageGenCode("CONFIG_ERROR")).toBe(400);
    expect(statusForImageGenCode("WORKFLOW_INVALID")).toBe(422);
    expect(statusForImageGenCode("COMFYUI_UNAVAILABLE")).toBe(503);
    expect(statusForImageGenCode("EXECUTION_ERROR")).toBe(502);
    expect(statusForImageGenCode("IMAGE_DOWNLOAD_ERROR")).toBe(502);
  });
});
