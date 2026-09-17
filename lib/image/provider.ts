/**
 * 图片生成 Provider 抽象（阶段 12）。
 *
 * 业务层只依赖这一层：它拿到的是「生成结果」，不是 ComfyUI 的 `/prompt` / `/history` /
 * `/view`，也不是节点 JSON 或 `class_type`。换后端时业务代码不动。
 *
 * 与 `lib\llm\provider.ts` 同构（接口 + 领域错误类），保持项目内的抽象风格一致。
 */

/** 一次生成请求 —— 只描述「画什么、多大、怎么采样」，不含任何后端概念 */
export interface GenerationRequest {
  prompt: string;
  negativePrompt?: string;
  /** 输出尺寸（像素） */
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  /** 模型文件名；缺省走配置默认（不硬编码在业务逻辑里） */
  checkpoint?: string;
  denoise?: number;
  /** 后端产出文件名的前缀（仅供可读性，不是契约） */
  filenamePrefix?: string;
}

/**
 * 生成结果 —— 稳定、与后端无关的结构。
 * 回填了**实际生效**的参数（含默认值），便于调用方复现同一次生成。
 */
export interface GenerationResult {
  /** 本次生成的唯一 id */
  id: string;
  status: "succeeded";
  /** provider 标识，如 "comfyui" */
  provider: string;
  prompt: string;
  negativePrompt?: string;
  seed: number;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  /** 产出文件信息 */
  filename: string;
  mimeType: string;
  bytes: number;
  /** 已落盘的 artifact 路径 */
  artifactPath: string;
  /** 可取回该图的 URL（后端直链，便于 UI 直接展示） */
  url: string;
}

/**
 * 失败阶段分类 —— 让调用方与日志一眼看出卡在哪一步，
 * 而不是笼统的 "Generation failed"。
 */
export type ImageGenErrorCode =
  /** 配置缺失/非法（baseUrl 等） */
  | "CONFIG_ERROR"
  /** 实例不可达 */
  | "COMFYUI_UNAVAILABLE"
  /** `/object_info` 拉不到或形状不对 */
  | "SCHEMA_INVALID"
  /** 机械校验未过（含非法 checkpoint / 非法枚举 / 缺必要输入） */
  | "WORKFLOW_INVALID"
  /** `POST /prompt` 被拒 */
  | "QUEUE_ERROR"
  /** 执行失败或超时 */
  | "EXECUTION_ERROR"
  /** 执行完成但没有输出图片 */
  | "OUTPUT_NOT_FOUND"
  /** `GET /view` 取图失败或字节非法 */
  | "IMAGE_DOWNLOAD_ERROR";

/**
 * 生成失败 —— 带 `code`（失败阶段）与 `details`（原始上下文）。
 *
 * `details` 保留后端原始信息供排查，但**调用方不应解析它** —— 契约是 `code` + `message`。
 */
export class ImageGenError extends Error {
  constructor(
    readonly code: ImageGenErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ImageGenError";
  }
}

/**
 * 图片生成后端。
 *
 * 当前只有 `ComfyUIProvider`；接口在这里留出替换位，
 * 避免业务层把后端锁死在某一家。
 */
export interface ImageGenerationProvider {
  /** provider 标识，如 "comfyui" */
  readonly id: string;
  /** 执行一次生成；失败以 ImageGenError（带 code）抛出 */
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
