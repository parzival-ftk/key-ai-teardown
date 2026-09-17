import { describe, it, expect, vi } from "vitest";
import {
  ComfyUIProvider,
  TXT2IMG_REQUIRED_NODES,
  createComfyUIProviderFromEnv,
  type ComfyUIProviderConfig,
} from "./comfyui-provider";
import { ImageGenError, type GenerationRequest } from "./provider";

/**
 * 假 `/object_info`：只含 txt2img 用到的 6 个节点，形状与真实 ComfyUI 一致
 * （required: { 名: [类型或允许值数组, 选项?] }）。
 */
const OBJECT_INFO = {
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [["v1-5-pruned-emaonly-fp16.safetensors"]] } },
  },
  CLIPTextEncode: {
    input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP"] } },
  },
  EmptyLatentImage: {
    input: {
      required: {
        width: ["INT", { default: 512, min: 16, max: 16384 }],
        height: ["INT", { default: 512, min: 16, max: 16384 }],
        batch_size: ["INT", { default: 1, min: 1, max: 4096 }],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        model: ["MODEL"],
        seed: ["INT", { default: 0 }],
        steps: ["INT", { default: 20 }],
        cfg: ["FLOAT", { default: 8 }],
        sampler_name: [["euler", "dpmpp_2m"]],
        scheduler: [["normal", "karras"]],
        positive: ["CONDITIONING"],
        negative: ["CONDITIONING"],
        latent_image: ["LATENT"],
        denoise: ["FLOAT", { default: 1 }],
      },
    },
  },
  VAEDecode: { input: { required: { samples: ["LATENT"], vae: ["VAE"] } } },
  SaveImage: {
    input: { required: { images: ["IMAGE"], filename_prefix: ["STRING", { default: "ComfyUI" }] } },
  },
};

/** 一张最小合法 PNG（8 字节魔数 + 后面随便） */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
]);

const HAPPY_HISTORY = {
  "job-1": {
    outputs: {
      "7": { images: [{ filename: "key_txt2img_00009_.png", subfolder: "", type: "output" }] },
    },
    status: { status_str: "success", completed: true, messages: [["execution_success", {}]] },
  },
};

/* ── 假的 fetch 路由器 ── */

type Route = (init?: RequestInit) => unknown;

function fakeFetch(routes: Record<string, Route>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((pattern) => path.startsWith(pattern));
    if (!key) throw new Error(`fakeFetch 未覆盖：${path}`);
    return routes[key](init);
  }) as unknown as typeof fetch;
}

const jsonRes = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const bytesRes = (bytes: Uint8Array, ok = true, status = 200) => ({
  ok,
  status,
  arrayBuffer: async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

/** 默认「全绿」路由，可按需覆盖其中几条 */
function happyRoutes(overrides: Record<string, Route> = {}) {
  return {
    "/system_stats": () => jsonRes({ system: { comfyui_version: "test" }, devices: [] }),
    "/object_info": () => jsonRes(OBJECT_INFO),
    "/prompt": () => jsonRes({ prompt_id: "job-1", number: 0 }),
    "/history/job-1": () => jsonRes(HAPPY_HISTORY),
    "/view": () => bytesRes(PNG_BYTES),
    ...overrides,
  };
}

function harness(
  overrides: Record<string, Route> = {},
  config: Partial<ComfyUIProviderConfig> = {},
) {
  const written: { path: string; bytes: number }[] = [];
  const provider = new ComfyUIProvider({
    baseUrl: "http://127.0.0.1:8188",
    artifactDir: "/tmp/key-artifacts",
    fetchImpl: fakeFetch(happyRoutes(overrides)),
    pollIntervalMs: 1,
    sleep: async () => {},
    writeArtifact: async (path, bytes) => {
      written.push({ path, bytes: bytes.length });
      return path;
    },
    ...config,
  });
  return { provider, written };
}

const REQUEST: GenerationRequest = {
  prompt: "一只坐在窗台上的猫",
  checkpoint: "v1-5-pruned-emaonly-fp16.safetensors",
};

/** 断言抛出的 ImageGenError 的 code */
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ImageGenError);
  await promise.catch((error: ImageGenError) => {
    expect(error.code).toBe(code);
  });
}

describe("ComfyUIProvider：成功路径", () => {
  it("走完 system_stats → object_info → validate → prompt → history → view → 落盘，返回稳定结果", async () => {
    const { provider, written } = harness();
    const result = await provider.generate(REQUEST);

    expect(result.status).toBe("succeeded");
    expect(result.provider).toBe("comfyui");
    expect(result.id).toBe("job-1");
    expect(result.filename).toBe("key_txt2img_00009_.png");
    expect(result.bytes).toBe(PNG_BYTES.length);
    expect(result.mimeType).toBe("image/png");
    expect(result.artifactPath).toContain("key_txt2img_00009_.png");
    expect(result.url).toContain("/view?");
    // 回填了实际生效参数
    expect(result.checkpoint).toBe("v1-5-pruned-emaonly-fp16.safetensors");
    expect(result.width).toBe(512);
    expect(result.steps).toBe(20);
    expect(result.sampler).toBe("euler");
    // 确实落盘了
    expect(written).toHaveLength(1);
    expect(written[0].bytes).toBe(PNG_BYTES.length);
  });

  it("request 里的参数覆盖默认值，并回填进结果", async () => {
    const { provider } = harness();
    const result = await provider.generate({
      ...REQUEST,
      width: 768,
      height: 512,
      steps: 30,
      cfg: 5,
      seed: 42,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    });
    expect(result).toMatchObject({
      width: 768,
      height: 512,
      steps: 30,
      cfg: 5,
      seed: 42,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    });
  });

  it("发送到 /prompt 的是构造好的 workflow（不是 request 原文）", async () => {
    const sent: unknown[] = [];
    const { provider } = harness({
      "/prompt": (init) => {
        sent.push(JSON.parse(String(init?.body)));
        return jsonRes({ prompt_id: "job-1", number: 0 });
      },
    });
    await provider.generate(REQUEST);
    const body = sent[0] as { prompt: Record<string, { class_type: string }> };
    const classes = Object.values(body.prompt).map((n) => n.class_type);
    expect(classes).toContain("CheckpointLoaderSimple");
    expect(classes).toContain("KSampler");
    expect(classes).toContain("SaveImage");
  });

  it("从 history 取真实 output，而不是假设固定文件名", async () => {
    const { provider } = harness({
      "/history/job-1": () =>
        jsonRes({
          "job-1": {
            outputs: {
              "7": {
                images: [{ filename: "completely_other_name_0042_.png", subfolder: "sub", type: "output" }],
              },
            },
            status: { status_str: "success", completed: true },
          },
        }),
    });
    const result = await provider.generate(REQUEST);
    expect(result.filename).toBe("completely_other_name_0042_.png");
    expect(result.artifactPath).toContain("completely_other_name_0042_.png");
  });
});

describe("ComfyUIProvider：错误分类（每类都要能一眼看出卡在哪）", () => {
  it("baseUrl 缺失/非法 → CONFIG_ERROR", async () => {
    const { provider } = harness({}, { baseUrl: "not-a-url" });
    await expectCode(provider.generate(REQUEST), "CONFIG_ERROR");
  });

  it("实例不可达 → COMFYUI_UNAVAILABLE", async () => {
    const { provider } = harness({
      "/system_stats": () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expectCode(provider.generate(REQUEST), "COMFYUI_UNAVAILABLE");
  });

  it("/object_info 形状不对 → SCHEMA_INVALID", async () => {
    const { provider } = harness({ "/object_info": () => jsonRes("not-an-object") });
    await expectCode(provider.generate(REQUEST), "SCHEMA_INVALID");
  });

  it("非法 checkpoint（不在真实允许列表）→ WORKFLOW_INVALID，且**不提交** /prompt", async () => {
    let prompted = false;
    const { provider } = harness({
      "/prompt": () => {
        prompted = true;
        return jsonRes({ prompt_id: "job-1" });
      },
    });
    await expectCode(
      provider.generate({ ...REQUEST, checkpoint: "not-installed.safetensors" }),
      "WORKFLOW_INVALID",
    );
    expect(prompted).toBe(false);
  });

  it("非法 scheduler → WORKFLOW_INVALID（枚举校验不放宽）", async () => {
    const { provider } = harness();
    await expectCode(provider.generate({ ...REQUEST, scheduler: "yyy" }), "WORKFLOW_INVALID");
  });

  it("POST /prompt 被拒 → QUEUE_ERROR", async () => {
    const { provider } = harness({
      "/prompt": () => jsonRes({ error: "bad graph" }, false, 400),
    });
    await expectCode(provider.generate(REQUEST), "QUEUE_ERROR");
  });

  it("后端未给 prompt_id → QUEUE_ERROR", async () => {
    const { provider } = harness({ "/prompt": () => jsonRes({ number: 0 }) });
    await expectCode(provider.generate(REQUEST), "QUEUE_ERROR");
  });

  it("执行超时（history 一直空）→ EXECUTION_ERROR", async () => {
    const { provider } = harness(
      { "/history/job-1": () => jsonRes({}) },
      { timeoutMs: 5, pollIntervalMs: 1 },
    );
    await expectCode(provider.generate(REQUEST), "EXECUTION_ERROR");
  });

  it("history 里 status 为 error → EXECUTION_ERROR，并带原始上下文", async () => {
    const { provider } = harness({
      "/history/job-1": () =>
        jsonRes({
          "job-1": {
            outputs: {},
            status: { status_str: "error", completed: false, messages: [["execution_error", { node: "5" }]] },
          },
        }),
    });
    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      code: "EXECUTION_ERROR",
    });
  });

  it("执行完成但没有输出图片 → OUTPUT_NOT_FOUND", async () => {
    const { provider } = harness({
      "/history/job-1": () =>
        jsonRes({ "job-1": { outputs: {}, status: { status_str: "success", completed: true } } }),
    });
    await expectCode(provider.generate(REQUEST), "OUTPUT_NOT_FOUND");
  });

  it("/view 返回非图片字节 → IMAGE_DOWNLOAD_ERROR", async () => {
    const { provider } = harness({
      "/view": () => bytesRes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    });
    await expectCode(provider.generate(REQUEST), "IMAGE_DOWNLOAD_ERROR");
  });

  it("/view HTTP 失败 → IMAGE_DOWNLOAD_ERROR", async () => {
    const { provider } = harness({ "/view": () => bytesRes(PNG_BYTES, false, 500) });
    await expectCode(provider.generate(REQUEST), "IMAGE_DOWNLOAD_ERROR");
  });
});

describe("ComfyUIProvider：契约常量", () => {
  it("txt2img 必备节点清单覆盖最小链路", () => {
    expect(TXT2IMG_REQUIRED_NODES).toEqual([
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage",
    ]);
  });
});

describe("createComfyUIProviderFromEnv：配置 → provider", () => {
  it("baseUrl 与 checkpoint 来自环境变量，业务调用方不写死", async () => {
    const provider = createComfyUIProviderFromEnv(
      {
        COMFYUI_BASE_URL: "http://127.0.0.1:8188",
        COMFYUI_CHECKPOINT: "v1-5-pruned-emaonly-fp16.safetensors",
      },
      {
        artifactDir: "/tmp/key-artifacts",
        fetchImpl: fakeFetch(happyRoutes()),
        pollIntervalMs: 1,
        sleep: async () => {},
        writeArtifact: async (path) => path,
      },
    );

    expect(provider.id).toBe("comfyui");
    // request 里不传 checkpoint，走配置默认
    const result = await provider.generate({ prompt: "一只坐在窗台上的猫" });
    expect(result.checkpoint).toBe("v1-5-pruned-emaonly-fp16.safetensors");
    expect(result.provider).toBe("comfyui");
  });
});
