import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_CFG,
  DEFAULT_CHECKPOINT,
  DEFAULT_HEIGHT,
  DEFAULT_SAMPLER,
  DEFAULT_SCHEDULER,
  DEFAULT_STEPS,
  DEFAULT_TXT2IMG_DENOISE,
  DEFAULT_WIDTH,
  buildTxt2ImgWorkflow,
  isValidComfyBaseUrl,
  type ComfyWorkflow,
} from "../canvas/comfy-bridge";
import {
  getAvailableCheckpoints,
  renderWorkflowReport,
  type ComfyObjectInfo,
} from "../canvas/comfy-doctor";
import {
  ImageGenError,
  type GenerationRequest,
  type GenerationResult,
  type ImageGenerationProvider,
} from "./provider";
import { readComfyUIEnv } from "../config";

/**
 * ComfyUI 图片生成 Provider（阶段 12）。
 *
 * 把原先散在 `scripts\comfy-txt2img.ts` 里的一次性流程（探测 → 取自省 → 构造 → 校验 →
 * 提交 → 轮询 → 下载 → 落盘）收成一个可注入、可单测、可配置的 provider。
 *
 * 分工：
 *   - 节点图构造  → `buildTxt2ImgWorkflow`（已对真实 0.34.0 验证，不改）
 *   - 机械校验    → `renderWorkflowReport`（照真实 `/object_info` 逐项比对，不放宽）
 *   - HTTP 细节   → 本文件（业务层看不到 /prompt /history /view / class_type）
 */

/** txt2img 最小链路的必备节点（缺一即 WORKFLOW_INVALID） */
export const TXT2IMG_REQUIRED_NODES = [
  "CheckpointLoaderSimple",
  "CLIPTextEncode",
  "EmptyLatentImage",
  "KSampler",
  "VAEDecode",
  "SaveImage",
] as const;

/** 默认反向提示词（与既有桥接保持一致） */
const DEFAULT_NEGATIVE_PROMPT = "低质量, 模糊, 变形";
const DEFAULT_POLL_MS = 400;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_JSON_TIMEOUT_MS = 30_000;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface ComfyUIProviderConfig {
  /** ComfyUI 基址（如 http://127.0.0.1:8188） */
  baseUrl: string;
  /** 产出图片的落盘目录 */
  artifactDir: string;
  /** 注入 fetch（单测用；缺省用全局 fetch） */
  fetchImpl?: typeof fetch;
  /** 单次生成的等待上限（毫秒），默认 120000 */
  timeoutMs?: number;
  /** /history 轮询间隔（毫秒），默认 400 */
  pollIntervalMs?: number;
  /** 未显式指定时的默认模型名（业务层不写死，走配置） */
  defaultCheckpoint?: string;
  /** 未显式指定时的默认反向提示词 */
  defaultNegativePrompt?: string;
  /** 注入文件写入（单测用）；返回实际落盘路径 */
  writeArtifact?: (path: string, bytes: Uint8Array) => Promise<string>;
  /** 注入 sleep（单测用） */
  sleep?: (ms: number) => Promise<void>;
}

interface JsonResult {
  ok: boolean;
  status: number;
  body: unknown;
}

interface BytesResult {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
}

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename?: string; subfolder?: string; type?: string }[] }>;
  status?: unknown;
}

interface PickedImage {
  nodeId: string;
  filename: string;
  subfolder: string;
  type: string;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 从字节嗅探图片类型（比信任 Content-Type 更硬的判据） */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/** 执行状态是否失败（ComfyUI 的 history.status.status_str） */
function isFailedStatus(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  return (status as { status_str?: unknown }).status_str === "error";
}

/** 从 history.outputs 里取第一张产出图（不假设节点 id 与文件名） */
function firstImage(outputs: HistoryEntry["outputs"]): PickedImage | null {
  for (const [nodeId, output] of Object.entries(outputs ?? {})) {
    const images = output?.images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      const filename = String(first?.filename ?? "");
      if (!filename) continue;
      return {
        nodeId,
        filename,
        subfolder: String(first?.subfolder ?? ""),
        type: String(first?.type ?? "output"),
      };
    }
  }
  return null;
}

export class ComfyUIProvider implements ImageGenerationProvider {
  readonly id = "comfyui";

  private readonly config: ComfyUIProviderConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: ComfyUIProviderConfig) {
    this.config = config;
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new ImageGenError("CONFIG_ERROR", "当前环境没有 fetch，请注入 fetchImpl");
    }
    this.fetchImpl = fetchImpl;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const baseUrl = (this.config.baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!isValidComfyBaseUrl(baseUrl)) {
      throw new ImageGenError(
        "CONFIG_ERROR",
        `ComfyUI 基址非法：${this.config.baseUrl || "(空)"}（应为 http(s)://host:port）`,
      );
    }
    if (!this.config.artifactDir) {
      throw new ImageGenError("CONFIG_ERROR", "缺少 artifactDir（产出图片的落盘目录）");
    }

    /* ① 实例可达 */
    const stats = await this.fetchJson(`${baseUrl}/system_stats`).catch((error: unknown) => {
      throw new ImageGenError(
        "COMFYUI_UNAVAILABLE",
        `连不上 ComfyUI（${baseUrl}）：${messageOf(error)}`,
        error,
      );
    });
    if (!stats.ok) {
      throw new ImageGenError(
        "COMFYUI_UNAVAILABLE",
        `ComfyUI /system_stats 返回 HTTP ${stats.status}`,
        stats.body,
      );
    }

    /* ② 节点自省（真实 schema 是后续校验的唯一依据） */
    const info = await this.fetchJson(`${baseUrl}/object_info`, undefined, 60_000).catch(
      (error: unknown) => {
        throw new ImageGenError("SCHEMA_INVALID", `拉取 /object_info 失败：${messageOf(error)}`, error);
      },
    );
    if (!info.ok || typeof info.body !== "object" || info.body === null) {
      throw new ImageGenError("SCHEMA_INVALID", `/object_info 返回不可用（HTTP ${info.status}）`, info.body);
    }
    const objectInfo = info.body as ComfyObjectInfo;

    /* ③ 构造 workflow（实际生效参数在这里回填，后面原样返回） */
    const checkpoint = request.checkpoint ?? this.config.defaultCheckpoint ?? DEFAULT_CHECKPOINT;
    const negativePrompt = request.negativePrompt ?? this.config.defaultNegativePrompt ?? DEFAULT_NEGATIVE_PROMPT;
    const width = request.width ?? DEFAULT_WIDTH;
    const height = request.height ?? DEFAULT_HEIGHT;
    const steps = request.steps ?? DEFAULT_STEPS;
    const cfg = request.cfg ?? DEFAULT_CFG;
    const seed = request.seed ?? 0;
    const sampler = request.sampler ?? DEFAULT_SAMPLER;
    const scheduler = request.scheduler ?? DEFAULT_SCHEDULER;

    const workflow: ComfyWorkflow = buildTxt2ImgWorkflow({
      prompt: request.prompt,
      negativePrompt,
      checkpoint,
      width,
      height,
      steps,
      cfg,
      seed,
      samplerName: sampler,
      scheduler,
      denoise: request.denoise ?? DEFAULT_TXT2IMG_DENOISE,
      ...(request.filenamePrefix ? { filenamePrefix: request.filenamePrefix } : {}),
    });

    /* ④ 机械校验 —— 非法 checkpoint / 枚举 / 缺必要输入都在这里被拦下（提交之前） */
    const report = renderWorkflowReport(workflow, objectInfo, {
      requireNodes: [...TXT2IMG_REQUIRED_NODES],
    });
    if (report.verdict === "blocked") {
      const fails = report.findings.filter((finding) => finding.level === "fail");
      const detail = fails
        .map(
          (finding) =>
            `${finding.id}: ${finding.message}` +
            (finding.expected ? `（allowed: ${finding.expected}）` : ""),
        )
        .join("; ");
      throw new ImageGenError("WORKFLOW_INVALID", `workflow 校验未通过：${detail}`, {
        findings: fails,
        availableCheckpoints: getAvailableCheckpoints(objectInfo),
      });
    }

    /* ⑤ 提交 /prompt */
    const clientId = `key-image-${Math.random().toString(36).slice(2, 10)}`;
    const submit = await this.fetchJson(
      `${baseUrl}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      },
      DEFAULT_JSON_TIMEOUT_MS,
    ).catch((error: unknown) => {
      throw new ImageGenError("QUEUE_ERROR", `提交 /prompt 失败：${messageOf(error)}`, error);
    });
    if (!submit.ok) {
      throw new ImageGenError("QUEUE_ERROR", `POST /prompt 返回 HTTP ${submit.status}`, submit.body);
    }
    const promptId = (submit.body as { prompt_id?: string } | null)?.prompt_id ?? "";
    if (!promptId) {
      throw new ImageGenError("QUEUE_ERROR", "POST /prompt 未返回 prompt_id", submit.body);
    }

    /* ⑥ 轮询 /history */
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = this.config.pollIntervalMs ?? DEFAULT_POLL_MS;
    // deadline 之外的第二个防线：轮询次数上限，杜绝 sleep 被注入成 no-op 时的空转死循环
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollIntervalMs)) + 5);
    const deadline = Date.now() + timeoutMs;
    let record: HistoryEntry | undefined;
    for (let polls = 0; polls < maxPolls && Date.now() < deadline; polls++) {
      const history = await this.fetchJson(
        `${baseUrl}/history/${encodeURIComponent(promptId)}`,
        undefined,
        DEFAULT_JSON_TIMEOUT_MS,
      ).catch(() => null);
      const entry = history
        ? (history.body as Record<string, HistoryEntry> | null)?.[promptId]
        : undefined;
      if (entry) {
        record = entry;
        break;
      }
      await this.sleep(pollIntervalMs);
    }
    if (!record) {
      throw new ImageGenError("EXECUTION_ERROR", `等待执行结果超时（${timeoutMs}ms）`, { promptId });
    }
    if (isFailedStatus(record.status)) {
      throw new ImageGenError("EXECUTION_ERROR", "ComfyUI 执行失败", {
        promptId,
        status: record.status,
      });
    }

    /* ⑦ 解析输出 */
    const image = firstImage(record.outputs);
    if (!image) {
      throw new ImageGenError("OUTPUT_NOT_FOUND", "执行完成但没有任何输出图片", {
        promptId,
        status: record.status,
      });
    }

    /* ⑧ 取回图片字节 */
    const url = `${baseUrl}/view?${new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    }).toString()}`;
    const view = await this.fetchBytes(url).catch((error: unknown) => {
      throw new ImageGenError("IMAGE_DOWNLOAD_ERROR", `/view 请求失败：${messageOf(error)}`, error);
    });
    if (!view.ok) {
      throw new ImageGenError("IMAGE_DOWNLOAD_ERROR", `/view 返回 HTTP ${view.status}`, { url });
    }
    const mimeType = sniffMime(view.bytes);
    if (view.bytes.length === 0 || !mimeType) {
      throw new ImageGenError(
        "IMAGE_DOWNLOAD_ERROR",
        `/view 取回的字节不是有效图片（${view.bytes.length} bytes）`,
        { url },
      );
    }

    /* ⑨ 落盘 */
    const artifactPath = await this.persist(image.filename, view.bytes);

    return {
      id: promptId,
      status: "succeeded",
      provider: this.id,
      prompt: request.prompt,
      ...(negativePrompt ? { negativePrompt } : {}),
      seed,
      checkpoint,
      width,
      height,
      steps,
      cfg,
      sampler,
      scheduler,
      filename: image.filename,
      mimeType,
      bytes: view.bytes.length,
      artifactPath,
      url,
    };
  }

  /* ── 内部：HTTP 与落盘 ── */

  private async fetchJson(
    url: string,
    init?: RequestInit,
    timeoutMs = DEFAULT_JSON_TIMEOUT_MS,
  ): Promise<JsonResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* 非 JSON：保持文本 */
      }
      return { ok: response.ok, status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchBytes(url: string, timeoutMs = 60_000): Promise<BytesResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      const buffer = await response.arrayBuffer();
      return { ok: response.ok, status: response.status, bytes: new Uint8Array(buffer) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 把产出字节落盘。文件名取自后端（已是唯一的），并做最小清洗；
   * 若同名文件已存在则追加序号，保证 artifact 唯一。
   */
  private async persist(filename: string, bytes: Uint8Array): Promise<string> {
    const safe = filename.replace(/[^\w.\-]+/g, "_") || "image.png";
    const primary = join(this.config.artifactDir, safe);
    if (this.config.writeArtifact) {
      return this.config.writeArtifact(primary, bytes);
    }

    await mkdir(this.config.artifactDir, { recursive: true });
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : "";
    for (let attempt = 0; attempt < 100; attempt++) {
      const target = attempt === 0 ? primary : join(this.config.artifactDir, `${stem}-${attempt}${ext}`);
      try {
        await writeFile(target, bytes, { flag: "wx" });
        return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new ImageGenError("IMAGE_DOWNLOAD_ERROR", `无法为 ${safe} 找到可用的 artifact 路径`);
  }
}

/**
 * 从环境变量组装 ComfyUI provider（服务端使用）。
 *
 * 配置来源单一：`readComfyUIEnv`（`lib\config.ts`）。业务层只拿 `ImageGenerationProvider`
 * 接口，看不到 ComfyUI 的任何 HTTP 细节，也不直接读环境变量。
 */
export function createComfyUIProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<ComfyUIProviderConfig> = {},
): ImageGenerationProvider {
  const config = readComfyUIEnv(env);
  return new ComfyUIProvider({
    baseUrl: config.baseUrl,
    artifactDir: config.artifactDir,
    ...(config.checkpoint ? { defaultCheckpoint: config.checkpoint } : {}),
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
    ...overrides,
  });
}
