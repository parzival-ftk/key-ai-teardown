import {
  LLMError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type LLMProvider,
} from "../provider";

export interface OpenAICompatibleConfig {
  /** 厂商 baseURL，如 https://api.deepseek.com/v1 */
  baseURL: string;
  apiKey: string;
  model: string;
  /** 单次调用总超时（毫秒），默认 60s；覆盖「请求 → 读体 → 流结束」全程 */
  timeoutMs?: number;
  /** 注入 fetch（测试 / 自定义运行时） */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * OpenAI 兼容 Provider —— 覆盖 OpenAI / DeepSeek / 通义 / 智谱
 * （四家均提供 OpenAI 兼容端点，差异仅 baseURL + model）。
 *
 * 超时纪律：超时计时覆盖整个调用生命周期（含响应体读取与流式读取），
 * 不只在「拿到响应头」之前 —— 否则上游返回 200 头后挂起 body 会导致永久挂起。
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai-compatible";
  readonly model: string;

  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.baseURL) throw new LLMError("baseURL 不能为空");
    if (!config.apiKey) throw new LLMError("apiKey 不能为空");
    if (!config.model) throw new LLMError("model 不能为空");
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private endpoint(): string {
    return `${this.baseURL}/chat/completions`;
  }

  private buildBody(
    messages: ChatMessage[],
    options: ChatOptions | undefined,
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options?.model ?? this.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      stream,
    };
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options?.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  /**
   * 创建带总超时的 AbortSignal，返回 signal 与清理函数。
   * 调用方必须在**整个调用结束**（含读完响应体/流）后才 cleanup。
   */
  private createTimeoutSignal(external?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener("abort", onAbort, { once: true });
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        if (external) external.removeEventListener("abort", onAbort);
      },
    };
  }

  private async request(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      const res = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new LLMError(
          `LLM 请求失败：HTTP ${res.status} ${detail.slice(0, 300)}`,
          res.status,
        );
      }
      return res;
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMError("LLM 请求超时或被取消", undefined, err);
      }
      const cause =
        err instanceof Error && err.cause instanceof Error
          ? `（${err.cause.message}）`
          : "";
      throw new LLMError(
        `LLM 请求异常：${err instanceof Error ? err.message : String(err)}${cause}`,
        undefined,
        err,
      );
    }
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const { signal, cleanup } = this.createTimeoutSignal(options.signal);
    try {
      const res = await this.request(
        this.buildBody(messages, options, false),
        signal,
      );
      // 注意：读体也在超时保护范围内
      const json = (await res.json()) as ChatCompletionChunk;
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new LLMError("响应缺少 choices[0].message.content");
      }
      const usage = json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          }
        : undefined;
      return { content, model: json.model ?? this.model, usage };
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMError("LLM 请求超时或被取消", undefined, err);
      }
      throw new LLMError(
        `LLM 响应解析失败：${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err,
      );
    } finally {
      cleanup();
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<string> {
    const { signal, cleanup } = this.createTimeoutSignal(options.signal);
    try {
      const res = await this.request(
        this.buildBody(messages, options, true),
        signal,
      );
      if (!res.body) throw new LLMError("响应无 body，无法流式读取");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const extract = (rawLine: string): { done: boolean; delta?: string } => {
        const line = rawLine.trim();
        if (!line || !line.startsWith("data:")) return { done: false };
        const payload = line.slice("data:".length).trim();
        if (payload === "[DONE]") return { done: true };
        try {
          const chunk = JSON.parse(payload) as ChatCompletionChunk;
          const delta = chunk?.choices?.[0]?.delta?.content;
          return {
            done: false,
            delta:
              typeof delta === "string" && delta.length > 0 ? delta : undefined,
          };
        } catch {
          return { done: false };
        }
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const { done: finished, delta } = extract(rawLine);
            if (finished) return;
            if (delta) yield delta;
          }
        }
        // 流结束：flush 残留内容（上游最后一行可能不以换行结尾）
        if (buffer) {
          const { done: finished, delta } = extract(buffer);
          if (!finished && delta) yield delta;
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMError("LLM 流式请求超时或被取消", undefined, err);
      }
      throw new LLMError(
        `LLM 流式请求异常：${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err,
      );
    } finally {
      cleanup();
    }
  }
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
): LLMProvider {
  return new OpenAICompatibleProvider(config);
}
