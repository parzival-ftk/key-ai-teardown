/**
 * LLM Provider 抽象（设计规格 §3）。
 *
 * 一套接口切 OpenAI / DeepSeek / 通义 / 智谱 —— 全部走 OpenAI 兼容协议，
 * 通过 baseURL + model 切换厂商，不锁定任何一家。
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  /** 覆盖 provider 默认模型 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 期望输出格式（json 用于结构化契约） */
  responseFormat?: "text" | "json";
  /** 协作取消 */
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage?: ChatUsage;
}

export interface LLMProvider {
  /** provider 标识，如 "openai-compatible" */
  readonly id: string;
  /** 默认模型名 */
  readonly model: string;
  /** 一次性补全 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  /** 流式补全：逐段产出 delta 文本 */
  chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<string>;
}

/** Provider 调用失败（网络 / 鉴权 / 限流 / 协议） */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
