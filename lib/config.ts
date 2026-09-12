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

/**
 * 已知厂商预设（spec §12 开放问题：默认厂商在 Wave 0 决定）。
 * 均为 OpenAI 兼容端点，切换厂商只需改 baseURL + model。
 */
export const PROVIDER_PRESETS: Record<string, { baseURL: string; model: string }> =
  {
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

/** 读取并校验环境变量；未配置完整时返回 null（不抛错） */
export function readLLMEnv(
  env: Record<string, string | undefined> = process.env,
): LLMEnv | null {
  const parsed = LLMEnvSchema.safeParse(env);
  return parsed.success ? parsed.data : null;
}

/** 报告配置缺口，供页面提示（不抛错） */
export function getLLMConfigStatus(
  env: Record<string, string | undefined> = process.env,
): LLMConfigStatus {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  return {
    configured: missing.length === 0,
    missing: [...missing],
    baseURL: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
  };
}

/** 从环境变量构造 Provider；未配置完整则抛 LLMError */
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
