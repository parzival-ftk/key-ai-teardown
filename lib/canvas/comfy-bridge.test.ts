import { describe, it, expect, vi } from "vitest";
import {
  ComfyClient,
  DEFAULT_CHECKPOINT,
  buildInpaintWorkflow,
  buildTxt2ImgWorkflow,
  isValidComfyBaseUrl,
  toResultCanvasNode,
  toWebSocketUrl,
  type ComfyBridgeConfig,
  type ComfyConnectionState,
  type ComfyImageResult,
  type ComfyWebSocketLike,
  type ComfyWorkflow,
} from "./comfy-bridge";
import type { Rect } from "./viewport";

const BOUNDS: Rect = { x: 120, y: 80, width: 300, height: 200 };

class FakeSocket implements ComfyWebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  emitRaw(raw: string) {
    this.onmessage?.({ data: raw });
  }
  die() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

function harness(config: Partial<ComfyBridgeConfig> = {}) {
  const sockets: FakeSocket[] = [];
  const states: ComfyConnectionState[] = [];
  const progress: number[] = [];
  const nodes: (string | null)[] = [];
  const images: ComfyImageResult[] = [];
  const errors: Error[] = [];
  const client = new ComfyClient(
    {
      baseUrl: "http://127.0.0.1:8188",
      timeoutMs: 60,
      maxReconnects: 2,
      reconnectDelayMs: 5,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      ...config,
    },
    {
      onState: (s) => states.push(s),
      onProgress: (p) => progress.push(p),
      onExecutingNode: (n) => nodes.push(n),
      onImage: (i) => images.push(i),
      onError: (e) => errors.push(e),
    },
  );
  return { client, sockets, states, progress, nodes, images, errors };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeFetch = (body: unknown = { prompt_id: "p1", number: 1 }, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;

describe("地址工具", () => {
  it("http(s) → ws(s)，ws 原样，clientId 被编码", () => {
    expect(toWebSocketUrl("http://127.0.0.1:8188", "c1")).toBe(
      "ws://127.0.0.1:8188/ws?clientId=c1",
    );
    expect(toWebSocketUrl("https://box/", "c 1")).toBe("wss://box/ws?clientId=c%201");
    expect(toWebSocketUrl("ws://box:9000", "x")).toBe("ws://box:9000/ws?clientId=x");
  });

  it("基址校验只认 http(s)/ws(s)", () => {
    for (const ok of ["http://a", "https://a/b", "ws://a", "wss://a"]) {
      expect(isValidComfyBaseUrl(ok)).toBe(true);
    }
    for (const bad of ["", "   ", "127.0.0.1:8188", "ftp://a", "javascript:alert(1)"]) {
      expect(isValidComfyBaseUrl(bad)).toBe(false);
    }
  });
});

/** 按 class_type 找节点 id（测试不写死编号，避免重排即碎） */
const classId = (workflow: ComfyWorkflow, cls: string) =>
  Object.entries(workflow).find(([, node]) => node.class_type === cls)?.[0] ?? "";

describe("buildTxt2ImgWorkflow", () => {
  const wf = buildTxt2ImgWorkflow({ prompt: "一只坐在窗台上的猫" });

  it("只含最小文生图节点（无 inpaint 模块），正负各一个 CLIPTextEncode", () => {
    const classes = Object.values(wf).map((node) => node.class_type);
    for (const expected of [
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage",
    ]) {
      expect(classes).toContain(expected);
    }
    expect(classes).not.toContain("LoadImage");
    expect(classes).not.toContain("LoadImageMask");
    expect(classes).not.toContain("VAEEncodeForInpaint");
    expect(classes.filter((c) => c === "CLIPTextEncode")).toHaveLength(2);
  });

  it("连线真实有效：model/clip/vae 来自 checkpoint，latent 来自 EmptyLatentImage", () => {
    const ckpt = classId(wf, "CheckpointLoaderSimple");
    const ksampler = classId(wf, "KSampler");
    const empty = classId(wf, "EmptyLatentImage");
    const decode = classId(wf, "VAEDecode");
    const save = classId(wf, "SaveImage");

    expect(wf[ksampler].inputs.model).toEqual([ckpt, 0]);
    expect(wf[ksampler].inputs.latent_image).toEqual([empty, 0]);
    expect(wf[decode].inputs.samples).toEqual([ksampler, 0]);
    expect(wf[decode].inputs.vae).toEqual([ckpt, 2]);
    expect(wf[save].inputs.images).toEqual([decode, 0]);

    // 每条连线指向的节点 id 都必须在图内（无悬空引用）
    for (const node of Object.values(wf)) {
      for (const value of Object.values(node.inputs)) {
        if (Array.isArray(value) && typeof value[0] === "string") {
          expect(Object.keys(wf)).toContain(value[0] as string);
        }
      }
    }
  });

  it("提示词填入正向 CLIPTextEncode", () => {
    const texts = Object.values(wf)
      .filter((node) => node.class_type === "CLIPTextEncode")
      .map((node) => node.inputs.text);
    expect(texts).toContain("一只坐在窗台上的猫");
  });

  it("数值参数有默认值且可覆盖", () => {
    const ckpt = classId(wf, "CheckpointLoaderSimple");
    const empty = classId(wf, "EmptyLatentImage");
    const ksampler = classId(wf, "KSampler");
    expect(wf[empty].inputs).toMatchObject({ width: 512, height: 512, batch_size: 1 });
    expect(wf[ksampler].inputs).toMatchObject({
      steps: 20,
      cfg: 7.5,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
    });
    expect(wf[ckpt].inputs.ckpt_name).toBe(DEFAULT_CHECKPOINT);

    const custom = buildTxt2ImgWorkflow({
      prompt: "x",
      width: 768,
      height: 512,
      batchSize: 2,
      steps: 30,
      cfg: 5,
      seed: 42,
      checkpoint: "custom.safetensors",
      denoise: 0.8,
    });
    expect(custom[classId(custom, "EmptyLatentImage")].inputs).toMatchObject({
      width: 768,
      height: 512,
      batch_size: 2,
    });
    expect(custom[classId(custom, "KSampler")].inputs).toMatchObject({
      steps: 30,
      cfg: 5,
      seed: 42,
      denoise: 0.8,
    });
    expect(custom[classId(custom, "CheckpointLoaderSimple")].inputs.ckpt_name).toBe(
      "custom.safetensors",
    );
  });
});

describe("buildInpaintWorkflow", () => {
  const wf = buildInpaintWorkflow({
    prompt: "把这里改成一只猫",
    imageName: "upload_in.png",
    maskName: "upload_mask.png",
  });

  it("包含 inpaint 所需的节点图", () => {
    const classes = Object.values(wf).map((node) => node.class_type);
    for (const expected of [
      "LoadImage",
      "LoadImageMask",
      "CheckpointLoaderSimple",
      "VAEEncodeForInpaint",
      "CLIPTextEncode",
      "KSampler",
      "VAEDecode",
      "SaveImage",
    ]) {
      expect(classes).toContain(expected);
    }
  });

  it("LoadImage 引用的是**已上传的文件名**（ComfyUI 只认 input 目录里的文件，不吃 base64）", () => {
    expect(wf["5"].inputs.text).toBe("把这里改成一只猫");
    expect(wf["1"].inputs.image).toBe("upload_in.png");
    expect(wf["2"].inputs.image).toBe("upload_mask.png");
    expect(wf["2"].inputs.channel).toBe("red");
  });

  it("关键连线指向正确节点（latent 来自 inpaint 编码）", () => {
    expect(wf["4"].inputs.pixels).toEqual(["1", 0]);
    expect(wf["4"].inputs.mask).toEqual(["2", 0]);
    expect(wf["7"].inputs.latent_image).toEqual(["4", 0]);
    expect(wf["7"].inputs.positive).toEqual(["5", 0]);
    expect(wf["7"].inputs.negative).toEqual(["6", 0]);
    expect(wf["9"].inputs.images).toEqual(["8", 0]);
  });

  it("数值参数有默认值且可覆盖", () => {
    expect(wf["3"].inputs.ckpt_name).toBe(DEFAULT_CHECKPOINT);
    const custom = buildInpaintWorkflow({
      prompt: "x",
      imageName: "i.png",
      maskName: "m.png",
      steps: 30,
      cfg: 5,
      seed: 42,
      checkpoint: "custom.safetensors",
      denoise: 0.9,
    });
    expect(custom["7"].inputs).toMatchObject({
      steps: 30,
      cfg: 5,
      seed: 42,
      denoise: 0.9,
    });
    expect(custom["3"].inputs.ckpt_name).toBe("custom.safetensors");
  });
});

describe("ComfyClient：连接与握手", () => {
  it("连接成功进入 connected，并向正确地址发起 WS", async () => {
    const { client, sockets, states } = harness();
    const promise = client.connect();
    expect(sockets[0].url).toBe("ws://127.0.0.1:8188/ws?clientId=" + client.clientId);
    sockets[0].open();
    await promise;
    expect(client.stateValue).toBe("connected");
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("基址非法 → reject 且不建立连接", async () => {
    const { client, sockets } = harness({ baseUrl: "not-a-url" });
    await expect(client.connect()).rejects.toThrow("基址非法");
    expect(sockets).toHaveLength(0);
  });

  it("没有 WebSocket 且未注入工厂 → 明确报错", async () => {
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    try {
      const client = new ComfyClient({ baseUrl: "http://127.0.0.1:8188" });
      await expect(client.connect()).rejects.toThrow("没有 WebSocket");
    } finally {
      if (original) (globalThis as { WebSocket?: unknown }).WebSocket = original;
    }
  });
});

describe("ComfyClient：连接失败必须 settle（回归：曾永久挂起）", () => {
  it("后端不可达且不给重连 → connect() reject，不挂着", async () => {
    const { client, sockets, errors } = harness({ maxReconnects: 0 });
    const promise = client.connect();
    sockets[0].die(); // 连不上：socket 立刻关闭
    await expect(promise).rejects.toThrow("连接失败");
    expect(client.stateValue).toBe("closed");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("首次失败但重连成功 → 同一个 promise resolve", async () => {
    const { client, sockets } = harness({ maxReconnects: 2, reconnectDelayMs: 1 });
    const promise = client.connect();
    sockets[0].die();
    await sleep(20);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    await expect(promise).resolves.toBeUndefined();
    expect(client.stateValue).toBe("connected");
  });
});

describe("ComfyClient：uploadImage", () => {
  const uploadFetch = (body: unknown = { name: "key_mask_001.png", subfolder: "", type: "input" }, ok = true) =>
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;

  it("以 multipart 上传，返回后端可用文件名", async () => {
    const fetchImpl = uploadFetch();
    const { client, sockets } = harness({ fetchImpl });
    const connected = client.connect();
    sockets[0].open();
    await connected;

    const name = await client.uploadImage(
      "mask.png",
      new Blob(["x"], { type: "image/png" }),
    );
    expect(name).toBe("key_mask_001.png");

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8188/upload/image");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("image")).toBeTruthy();
    expect((init.body as FormData).get("overwrite")).toBe("true");
  });

  it("上传失败 → reject 带 HTTP 状态；未连接 → 明确报错", async () => {
    const { client, sockets } = harness({ fetchImpl: uploadFetch({}, false) });
    const connected = client.connect();
    sockets[0].open();
    await connected;
    await expect(
      client.uploadImage("a.png", new Blob(["x"], { type: "image/png" })),
    ).rejects.toThrow("HTTP 500");

    const idle = harness();
    await expect(
      idle.client.uploadImage("a.png", new Blob(["x"], { type: "image/png" })),
    ).rejects.toThrow("尚未连接");
  });
});

describe("ComfyClient：生成状态流", () => {
  it("提交 workflow 并解析进度 / 节点 / 产出图像", async () => {
    const fetchImpl = fakeFetch();
    const { client, sockets, progress, nodes, images } = harness({ fetchImpl });
    const connected = client.connect();
    sockets[0].open();
    await connected;

    const wf = buildInpaintWorkflow({
      prompt: "x",
      imageName: "in.png",
      maskName: "mask.png",
    });
    const promise = client.generate(wf);
    await flush();

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8188/prompt");
    expect(JSON.parse(String(init.body)).prompt).toEqual(wf);
    expect(JSON.parse(String(init.body)).client_id).toBe(client.clientId);

    sockets[0].emit({ type: "progress", data: { value: 5, max: 20 } });
    sockets[0].emit({ type: "executing", data: { node: "7" } });
    sockets[0].emit({
      type: "executed",
      data: { node: "9", output: { images: [{ filename: "key_0001.png", subfolder: "sub", type: "output" }] } },
    });

    const image = await promise;
    expect(image.filename).toBe("key_0001.png");
    expect(image.url).toBe("http://127.0.0.1:8188/view?filename=key_0001.png&subfolder=sub&type=output");
    expect(progress).toEqual([25]);
    expect(nodes).toEqual(["7"]);
    expect(images).toHaveLength(1);
  });

  it("executing 收到空 node 表示空闲（null）", async () => {
    const { client, sockets, nodes } = harness();
    const connected = client.connect();
    sockets[0].open();
    await connected;
    sockets[0].emit({ type: "executing", data: { node: null } });
    expect(nodes).toEqual([null]);
  });

  it("非 JSON 消息被忽略，不抛错也不影响后续消息", async () => {
    const { client, sockets, progress } = harness();
    const connected = client.connect();
    sockets[0].open();
    await connected;
    expect(() => sockets[0].emitRaw("这不是 JSON")).not.toThrow();
    sockets[0].emit({ type: "progress", data: { value: 1, max: 4 } });
    expect(progress).toEqual([25]);
  });

  it("未连接就 generate → 明确报错", async () => {
    const { client } = harness();
    await expect(
      client.generate(
        buildInpaintWorkflow({ prompt: "x", imageName: "in.png", maskName: "mask.png" }),
      ),
    ).rejects.toThrow("尚未连接");
  });

  it("HTTP 失败 → reject", async () => {
    const { client, sockets } = harness({ fetchImpl: fakeFetch({}, false) });
    const connected = client.connect();
    sockets[0].open();
    await connected;
    await expect(
      client.generate(
        buildInpaintWorkflow({ prompt: "x", imageName: "in.png", maskName: "mask.png" }),
      ),
    ).rejects.toThrow("HTTP 500");
  });

  it("生成超时 → reject 并带上超时毫秒数", async () => {
    const { client, sockets } = harness({ fetchImpl: fakeFetch(), timeoutMs: 20 });
    const connected = client.connect();
    sockets[0].open();
    await connected;
    await expect(
      client.generate(
        buildInpaintWorkflow({ prompt: "x", imageName: "in.png", maskName: "mask.png" }),
      ),
    ).rejects.toThrow("生成超时（20ms）");
  });

  it("后端 error 事件 → 报错并结束当前任务", async () => {
    const { client, sockets, errors } = harness({ fetchImpl: fakeFetch() });
    const connected = client.connect();
    sockets[0].open();
    await connected;
    const promise = client.generate(
      buildInpaintWorkflow({ prompt: "x", imageName: "in.png", maskName: "mask.png" }),
    );
    await flush();
    sockets[0].emit({ type: "error", data: { message: "model not found" } });
    await expect(promise).rejects.toThrow("ComfyUI 返回错误");
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("ComfyClient：断线重连与关闭", () => {
  it("意外断开 → 重连（不超过上限），用尽后报错", async () => {
    const { client, sockets, errors } = harness({ maxReconnects: 1, reconnectDelayMs: 1 });
    const connected = client.connect();
    sockets[0].open();
    await connected;

    sockets[0].die();
    expect(client.stateValue).toBe("reconnecting");
    await sleep(20);
    expect(sockets).toHaveLength(2); // 已重连

    sockets[1].die();
    await sleep(20);
    expect(client.stateValue).toBe("closed");
    expect(errors.some((e) => e.message.includes("重连次数用尽"))).toBe(true);
  });

  it("主动 close 不触发重连", async () => {
    const { client, sockets } = harness({ maxReconnects: 3, reconnectDelayMs: 1 });
    const connected = client.connect();
    sockets[0].open();
    await connected;

    client.close();
    expect(client.stateValue).toBe("closed");
    await sleep(20);
    expect(sockets).toHaveLength(1);
  });
});

describe("toResultCanvasNode", () => {
  const image: ComfyImageResult = {
    url: "http://127.0.0.1:8188/view?filename=a.png",
    filename: "a.png",
    subfolder: "",
  };

  it("落点即框选位置，尺寸沿用框选区域", () => {
    const node = toResultCanvasNode(image, BOUNDS, []);
    expect(node).toMatchObject({
      type: "image",
      x: 120,
      y: 80,
      width: 300,
      height: 200,
      src: image.url,
    });
    expect(node.zIndex).toBe(1);
  });

  it("置顶于既有节点之上", () => {
    const node = toResultCanvasNode(image, BOUNDS, [
      { id: "old", type: "frame", x: 0, y: 0, width: 10, height: 10, zIndex: 7 },
    ]);
    expect(node.zIndex).toBe(8);
  });
});
