import { z } from "zod";
import { LLMError, type LLMProvider } from "./llm/provider";
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from "./llm/providers/openai-compatible";

/** 配置缺失/非法 —— 与「上游调用失败」区分，供路由映射正确的 HTTP 状态码 */
export class LLMConfigError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

/** LLM 相关环境变量的 schema（全部来自 .env，服务端读取） */
export const LLMEnvSchema = z.object({
  LLM_BASE_URL: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
});

export type LLMEnv = z.infer<typeof LLMEnvSchema>;

export interface LLMConfigStatus {
  configured: boolean;
  /** 缺失的必填项 */
  missing: string[];
  baseURL?: string;
  model?: string;
}

const REQUIRED_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"] as const;

/** 成对包裹符（粘贴配置时常见） */
const WRAPPING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["<", ">"],
];

/**
 * 清洗环境变量值：去首尾空白，并剥掉成对的包裹符。
 *
 * 现实依据：从文档/聊天里复制 key 时常带上 <sk-...> 或 "sk-..."，
 * 直接送给上游会导致 401（key 里多了不可见包裹符）。此处统一剥离。
 * 例：`<sk-abc>` → `sk-abc`，`"https://x/v1"` → `https://x/v1`。
 */
export function sanitizeEnvValue(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  let value = raw.trim();
  for (const [open, close] of WRAPPING_PAIRS) {
    if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

/** 对 LLM_* 全部取值做清洗，返回可直接喂给 schema 的对象 */
function normalizedLLMEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    LLM_BASE_URL: sanitizeEnvValue(env.LLM_BASE_URL),
    LLM_API_KEY: sanitizeEnvValue(env.LLM_API_KEY),
    LLM_MODEL: sanitizeEnvValue(env.LLM_MODEL),
    LLM_TIMEOUT_MS: sanitizeEnvValue(env.LLM_TIMEOUT_MS),
  };
}

/**
 * 已知厂商预设（spec §12 开放问题：默认厂商在 Wave 0 决定）。
 * 均为 OpenAI 兼容端点，切换厂商只需改 baseURL + model。
 */
export const PROVIDER_PRESETS: Record<
  string,
  { baseURL: string; model: string }
> = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  zhipu: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
  },
};

/** 读取并校验环境变量（先清洗）；未配置完整时返回 null（不抛错） */
export function readLLMEnv(
  env: Record<string, string | undefined> = process.env,
): LLMEnv | null {
  const parsed = LLMEnvSchema.safeParse(normalizedLLMEnv(env));
  return parsed.success ? parsed.data : null;
}

/** 报告配置缺口，供页面提示（不抛错） */
export function getLLMConfigStatus(
  env: Record<string, string | undefined> = process.env,
): LLMConfigStatus {
  const normalized = normalizedLLMEnv(env);
  const missing = REQUIRED_KEYS.filter((key) => !normalized[key]);
  return {
    configured: missing.length === 0,
    missing: [...missing],
    baseURL: normalized.LLM_BASE_URL,
    model: normalized.LLM_MODEL,
  };
}

/** 从环境变量构造 Provider；未配置完整则抛 LLMConfigError */
export function createProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): LLMProvider {
  const config = readLLMEnv(env);
  if (!config) {
    const { missing } = getLLMConfigStatus(env);
    throw new LLMConfigError(
      `缺少 LLM 配置：${missing.join(", ")}。请复制 .env.example 为 .env 并填入你的 key。`,
    );
  }
  const providerConfig: OpenAICompatibleConfig = {
    baseURL: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
    model: config.LLM_MODEL,
    timeoutMs: config.LLM_TIMEOUT_MS,
  };
  return createOpenAICompatibleProvider(providerConfig);
}

/* ── ComfyUI（图片生成）配置 ── */

/** 本机默认的 ComfyUI 服务地址 */
export const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
/** 产出图片的默认落盘目录（运行时目录，不纳入版本管理） */
export const DEFAULT_COMFYUI_ARTIFACT_DIR = ".rivet/artifacts/comfy";

/** ComfyUI 相关环境变量的 schema（全部可缺省，缺省走默认值） */
export const ComfyUIEnvSchema = z.object({
  COMFYUI_BASE_URL: z.string().min(1).optional(),
  COMFYUI_CHECKPOINT: z.string().min(1).optional(),
  COMFYUI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  COMFYUI_ARTIFACT_DIR: z.string().min(1).optional(),
});

export interface ComfyUIConfig {
  /** 服务地址（换局域网机器 / 服务器只改这里） */
  baseUrl: string;
  /** 产出图片落盘目录 */
  artifactDir: string;
  /** 默认模型文件名；未配置则交给 provider 的兜底常量 */
  checkpoint?: string;
  timeoutMs?: number;
}

/**
 * 读取 ComfyUI 配置（先清洗，与 LLM_* 同一套规则）。
 *
 * 每一项都可缺省并回落到默认值，所以**永不返回 null** —— 与 `readLLMEnv` 的差异
 * 在于 ComfyUI 是本机可选能力，未配置时应能开箱用默认值，而不是报「未配置」。
 *
 * 兼容旧变量名 `COMFY_URL`（`scripts\comfy-doctor.ts` 早期用过）。
 */
export function readComfyUIEnv(
  env: Record<string, string | undefined> = process.env,
): ComfyUIConfig {
  const parsed = ComfyUIEnvSchema.safeParse({
    COMFYUI_BASE_URL: sanitizeEnvValue(env.COMFYUI_BASE_URL),
    COMFYUI_CHECKPOINT: sanitizeEnvValue(env.COMFYUI_CHECKPOINT),
    COMFYUI_TIMEOUT_MS: sanitizeEnvValue(env.COMFYUI_TIMEOUT_MS),
    COMFYUI_ARTIFACT_DIR: sanitizeEnvValue(env.COMFYUI_ARTIFACT_DIR),
  });
  const data = parsed.success ? parsed.data : {};
  const legacyBase = sanitizeEnvValue(env.COMFY_URL);
  return {
    baseUrl: data.COMFYUI_BASE_URL ?? legacyBase ?? DEFAULT_COMFYUI_BASE_URL,
    artifactDir: data.COMFYUI_ARTIFACT_DIR ?? DEFAULT_COMFYUI_ARTIFACT_DIR,
    ...(data.COMFYUI_CHECKPOINT ? { checkpoint: data.COMFYUI_CHECKPOINT } : {}),
    ...(data.COMFYUI_TIMEOUT_MS ? { timeoutMs: data.COMFYUI_TIMEOUT_MS } : {}),
  };
}
