import { createCanvasNode, type CanvasNode } from "./canvas-node";
import type { Rect } from "./viewport";

/**
 * ComfyUI 桥接（W30）—— 把画布上的框选变成一次生成请求，并把结果放回画布。
 *
 * 三段职责，彼此解耦：
 *   1. `buildInpaintWorkflow`：框选（bounding box）+ 遮罩 + Prompt → ComfyUI API 格式的
 *      workflow JSON（纯函数、可单测，不需要后端）；
 *   2. `ComfyClient`：WebSocket 连接与状态流（进度 / 执行中的节点 / 产出图像），
 *      含握手校验、断线重连、生成超时；
 *   3. `toResultCanvasNode`：把产出的图像落成画布节点，坐标即框选位置。
 *
 * 可测性：WebSocket 与 fetch 都可注入 —— 桥接的全部状态机逻辑能在 Node 里用假实现跑完，
 * 无需真实 ComfyUI 后端（真实链路的验证状况见交付说明）。
 */

/* ── ComfyUI workflow（API 格式） ── */

/** ComfyUI API 格式：节点 id → { class_type, inputs } */
export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type ComfyWorkflow = Record<string, ComfyNode>;

export interface InpaintWorkflowInput {
  /** 正向提示词（来自画布上的 Prompt 节点） */
  prompt: string;
  negativePrompt?: string;
  /** 源图：纯 base64（不含 `data:` 前缀） */
  imageBase64: string;
  /** 遮罩：纯 base64；白色区域 = 需要重绘 */
  maskBase64: string;
  /** 框选区域（画布坐标）—— 决定结果落回画布的哪个位置 */
  bounds: Rect;
  checkpoint?: string;
  steps?: number;
  cfg?: number;
  seed?: number;
  samplerName?: string;
  scheduler?: string;
  denoise?: number;
  /** 遮罩向外扩张像素，避免接缝 */
  growMaskBy?: number;
}

export const DEFAULT_CHECKPOINT = "sd_xl_base_1.0.safetensors";
export const DEFAULT_STEPS = 20;
export const DEFAULT_CFG = 7.5;
export const DEFAULT_SAMPLER = "euler";
export const DEFAULT_SCHEDULER = "normal";
export const DEFAULT_DENOISE = 0.75;
export const DEFAULT_GROW_MASK_BY = 6;

/** 去掉 `data:image/...;base64,` 前缀，只留纯 base64（ComfyUI 只吃纯串） */
export function stripDataUrlPrefix(value: string): string {
  const match = /^data:[^;,]*;base64,([\s\S]+)$/i.exec((value ?? "").trim());
  return (match ? match[1] : (value ?? "")).replace(/\s+/g, "");
}

/**
 * 由「框选 + 遮罩 + 提示词」构造 ComfyUI inpaint workflow。
 *
 * 节点图：LoadImage×2（原图 / 遮罩）→ Checkpoint → VAEEncodeForInpaint → KSampler → VAEDecode → SaveImage。
 * 所有数值参数都有默认值，调用方只需给 prompt / image / mask / bounds。
 */
export function buildInpaintWorkflow(input: InpaintWorkflowInput): ComfyWorkflow {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: stripDataUrlPrefix(input.imageBase64), upload: "image" },
    },
    "2": {
      class_type: "LoadImageMask",
      inputs: {
        image: stripDataUrlPrefix(input.maskBase64),
        channel: "red",
        upload: "image",
      },
    },
    "3": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: input.checkpoint ?? DEFAULT_CHECKPOINT },
    },
    "4": {
      class_type: "VAEEncodeForInpaint",
      inputs: {
        pixels: ["1", 0],
        vae: ["3", 2],
        mask: ["2", 0],
        grow_mask_by: input.growMaskBy ?? DEFAULT_GROW_MASK_BY,
      },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.prompt ?? "", clip: ["3", 1] },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: input.negativePrompt ?? "低质量, 模糊, 变形",
        clip: ["3", 1],
      },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["3", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["4", 0],
        seed: input.seed ?? 0,
        steps: input.steps ?? DEFAULT_STEPS,
        cfg: input.cfg ?? DEFAULT_CFG,
        sampler_name: input.samplerName ?? DEFAULT_SAMPLER,
        scheduler: input.scheduler ?? DEFAULT_SCHEDULER,
        denoise: input.denoise ?? DEFAULT_DENOISE,
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["3", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: "key_canvas" },
    },
  };
}

/* ── 事件与配置 ── */

export type ComfyConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface ComfyImageResult {
  /** 可直接喂给 <img src> 的地址（由 baseUrl + 文件名拼出） */
  url: string;
  filename: string;
  subfolder: string;
  /** 若后端直接给了 base64，则一并带上 */
  base64?: string;
}

export interface ComfyClientEvents {
  /** 连接状态变化 */
  onState?: (state: ComfyConnectionState) => void;
  /** 生成进度 0-100 */
  onProgress?: (percent: number, raw: { value: number; max: number }) => void;
  /** 当前正在执行的节点 id（null 表示空闲） */
  onExecutingNode?: (nodeId: string | null) => void;
  /** 拿到产出图像 */
  onImage?: (image: ComfyImageResult) => void;
  /** 出错（握手 / 超时 / 协议） */
  onError?: (error: Error) => void;
}

export interface ComfyWebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface ComfyBridgeConfig {
  /** ComfyUI 基址，如 http://127.0.0.1:8188（http/https 或 ws/wss 都能吃） */
  baseUrl: string;
  /** 客户端 id；缺省自动生成 */
  clientId?: string;
  /** 复用已有连接（连接池场景） */
  webSocketFactory?: (url: string) => ComfyWebSocketLike;
  fetchImpl?: typeof fetch;
  /** 单次生成超时（毫秒），默认 120000 */
  timeoutMs?: number;
  /** 断线重连上限（不含首次连接），默认 3 */
  maxReconnects?: number;
  /** 重连退避基数（毫秒），默认 500 */
  reconnectDelayMs?: number;
}

/** WebSocket 就绪态常量（避免依赖全局 WebSocket） */
export const WS_OPEN = 1;

/** 把 http(s) 基址换成 ws(s)（已是 ws/wss 则原样返回） */
export function toWebSocketUrl(baseUrl: string, clientId: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const ws = base.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  return `${ws}/ws?clientId=${encodeURIComponent(clientId)}`;
}

/** 校验基址是否为合法的 http(s)/ws(s) 地址（握手校验的第一道门） */
export function isValidComfyBaseUrl(baseUrl: string): boolean {
  const base = (baseUrl ?? "").trim();
  return /^(https?|wss?):\/\/[^\s/]+/i.test(base);
}

/* ── 客户端 ── */

interface PendingJob {
  promptId: string | null;
  resolve: (image: ComfyImageResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class ComfyClient {
  private readonly config: Required<
    Pick<ComfyBridgeConfig, "baseUrl" | "timeoutMs" | "maxReconnects" | "reconnectDelayMs">
  > &
    ComfyBridgeConfig;
  private readonly events: ComfyClientEvents;
  private socket: ComfyWebSocketLike | null = null;
  private state: ComfyConnectionState = "idle";
  private reconnects = 0;
  private manualClose = false;
  private job: PendingJob | null = null;

  constructor(config: ComfyBridgeConfig, events: ComfyClientEvents = {}) {
    this.config = {
      timeoutMs: 120_000,
      maxReconnects: 3,
      reconnectDelayMs: 500,
      ...config,
    };
    this.events = events;
  }

  get clientId(): string {
    if (!this.config.clientId) {
      this.config.clientId = `key-canvas-${Math.random().toString(36).slice(2, 10)}`;
    }
    return this.config.clientId;
  }

  get stateValue(): ComfyConnectionState {
    return this.state;
  }

  private setState(next: ComfyConnectionState) {
    this.state = next;
    this.events.onState?.(next);
  }

  private fail(error: Error) {
    this.events.onError?.(error);
    if (this.job) {
      const job = this.job;
      this.job = null;
      if (job.timer) clearTimeout(job.timer);
      job.reject(error);
    }
  }

  /** 建立 WebSocket；基址非法时立即以错误结束（不静默重试） */
  connect(): Promise<void> {
    this.manualClose = false;
    if (!isValidComfyBaseUrl(this.config.baseUrl)) {
      return Promise.reject(new Error(`ComfyUI 基址非法：${this.config.baseUrl || "(空)"}`));
    }
    const url = toWebSocketUrl(this.config.baseUrl, this.clientId);

    return new Promise<void>((resolve, reject) => {
      let factory = this.config.webSocketFactory;
      if (!factory) {
        const Ctor = (globalThis as { WebSocket?: new (url: string) => ComfyWebSocketLike })
          .WebSocket;
        if (!Ctor) {
          reject(new Error("当前环境没有 WebSocket，请注入 webSocketFactory"));
          return;
        }
        factory = (target) => new Ctor(target);
      }

      this.setState(this.reconnects > 0 ? "reconnecting" : "connecting");
      let socket: ComfyWebSocketLike;
      try {
        socket = factory(url);
      } catch (error) {
        const wrapped = new Error(
          `WebSocket 建立失败：${error instanceof Error ? error.message : String(error)}`,
        );
        this.fail(wrapped);
        reject(wrapped);
        return;
      }
      this.socket = socket;

      socket.onopen = () => {
        this.reconnects = 0;
        this.setState("connected");
        resolve();
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
      socket.onerror = () => {
        // 具体原因由 onclose/超时给出；这里不重复报错，避免噪声
      };
      socket.onclose = () => {
        this.socket = null;
        if (this.manualClose) {
          this.setState("closed");
          return;
        }
        if (this.reconnects < (this.config.maxReconnects ?? 0)) {
          this.reconnects += 1;
          this.setState("reconnecting");
          const delay = (this.config.reconnectDelayMs ?? 500) * this.reconnects;
          setTimeout(() => {
            if (this.manualClose) return;
            void this.connect().catch((error) => this.fail(error));
          }, delay);
          return;
        }
        this.setState("closed");
        this.fail(new Error("ComfyUI 连接已断开且重连次数用尽"));
      };
    });
  }

  /** 解析后端消息（`{type, data}`）—— 非 JSON 消息被忽略，不抛错 */
  private handleMessage(raw: unknown) {
    let payload: { type?: string; data?: Record<string, unknown> };
    try {
      payload = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    const data = payload.data ?? {};
    switch (payload.type) {
      case "progress": {
        const value = Number(data.value ?? 0);
        const max = Number(data.max ?? 0);
        const percent = max > 0 ? Math.round(Math.min(1, value / max) * 100) : 0;
        this.events.onProgress?.(percent, { value, max });
        break;
      }
      case "executing": {
        const node = data.node;
        this.events.onExecutingNode?.(
          typeof node === "string" && node !== "" ? node : null,
        );
        break;
      }
      case "executed": {
        const images = (data.output as { images?: unknown } | undefined)?.images;
        const first = Array.isArray(images) ? (images[0] as Record<string, unknown>) : null;
        if (!first) break;
        const filename = String(first.filename ?? "");
        const subfolder = String(first.subfolder ?? "");
        const type = String(first.type ?? "output");
        if (!filename) break;
        const image: ComfyImageResult = {
          filename,
          subfolder,
          url: this.imageUrl(filename, subfolder, type),
        };
        if (typeof first.data === "string") image.base64 = first.data;
        this.events.onImage?.(image);
        this.settleJob(image);
        break;
      }
      case "error": {
        this.fail(new Error(`ComfyUI 返回错误：${JSON.stringify(data)}`));
        break;
      }
      default:
        break; // 其余事件（status / execution_cached 等）当前不影响状态机
    }
  }

  private imageUrl(filename: string, subfolder: string, type: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({
      filename,
      subfolder,
      type,
    });
    return `${base}/view?${params.toString()}`;
  }

  private settleJob(image: ComfyImageResult) {
    const job = this.job;
    if (!job) return;
    this.job = null;
    if (job.timer) clearTimeout(job.timer);
    job.resolve(image);
  }

  /**
   * 提交 workflow 并等待首张产出图像。
   * 超时 / HTTP 失败 / 后端 error 事件都会以 reject 结束（不抛同步异常）。
   */
  async generate(workflow: ComfyWorkflow): Promise<ComfyImageResult> {
    if (this.state !== "connected") {
      throw new Error("尚未连接 ComfyUI，请先 connect()");
    }
    if (this.job) {
      throw new Error("已有生成任务在进行中（一次只允许一个）");
    }

    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) throw new Error("当前环境没有 fetch，请注入 fetchImpl");

    const response = await fetchImpl(`${this.config.baseUrl.replace(/\/+$/, "")}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    if (!response.ok) {
      throw new Error(`提交 workflow 失败：HTTP ${response.status}`);
    }
    const body = (await response.json()) as { prompt_id?: string; number?: number };

    return new Promise<ComfyImageResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.job?.promptId === (body.prompt_id ?? null)) this.job = null;
        reject(new Error(`生成超时（${this.config.timeoutMs}ms）`));
      }, this.config.timeoutMs);
      this.job = { promptId: body.prompt_id ?? null, resolve, reject, timer };
    });
  }

  /** 主动关闭（不触发重连） */
  close() {
    this.manualClose = true;
    try {
      this.socket?.close();
    } catch {
      /* 已关闭 */
    }
    this.socket = null;
    if (this.job?.timer) clearTimeout(this.job.timer);
    this.job = null;
    this.setState("closed");
  }
}

/* ── 落回画布 ── */

/**
 * 把生成结果落成画布节点：**坐标即框选位置**（结果出现在用户框的地方）。
 * 尺寸缺省沿用框选区域的尺寸，避免结果比选区小一圈。
 */
export function toResultCanvasNode(
  image: ComfyImageResult,
  bounds: Rect,
  existing: CanvasNode[] = [],
  label = "生成结果",
): CanvasNode {
  return createCanvasNode(
    {
      type: "image",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width > 0 ? bounds.width : undefined,
      height: bounds.height > 0 ? bounds.height : undefined,
      label,
      src: image.url,
    },
    existing,
  );
}
