import type { ChatMessage, LLMProvider } from "@/lib/llm/provider";
import type { AgentEvent } from "@/lib/types/events";
import type { Evidence } from "@/lib/types/evidence";
import {
  findMetadataStart,
  normalizeEvidence,
  parseStructuredOutput,
} from "./structured-output";

/**
 * 流式补全 + 结构化解析（W10/W11 复用）。
 *
 * 从 framework-agent 抽出：编队 Agent 与对比官共用同一套「逐字 emit → 剥离元数据
 * → 归一化证据」逻辑，避免两处各写一份而漂移。
 *
 * 行为契约（与抽取前一致）：
 * - 正文逐字 emit 为 `agent:token`；一旦检测到元数据区起点就不再向用户外泄。
 * - 流结束后剥离结构化元数据；解析失败自动降级为纯文本。
 * - 证据按 `inputText` 做 W1 归一化（verified 来源无法追溯则降级 inferred）。
 */

/** 流式阶段为「元数据起点」保留的安全尾长（覆盖最长的可能前缀，避免吐半截） */
const SAFE_TAIL = 16;

export interface CompletionStreamResult {
  /** 剥离元数据块后的正文 */
  text: string;
  confidence?: number;
  evidence: Evidence[];
  /** W15：PRD 声明回应的质疑 id（其它 Agent 为空数组） */
  addressedCriticIds: string[];
}

export interface CompletionStreamParams {
  provider: LLMProvider;
  messages: ChatMessage[];
  /** 本次补全所属的 Agent id（emit 的 token 事件带此 id） */
  agentId: string;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** 用于 W1 证据归一化的「本次输入文本」 */
  inputText: string;
}

export async function runCompletionStream(
  params: CompletionStreamParams,
): Promise<CompletionStreamResult> {
  const { provider, messages, agentId, emit, signal, inputText } = params;

  let raw = "";
  let emitted = 0;
  let metadataStarted = false;

  const flushVisible = (upTo: number) => {
    if (upTo <= emitted) return;
    const delta = raw.slice(emitted, upTo);
    emitted = upTo;
    if (delta) emit({ type: "agent:token", agentId, delta });
  };

  for await (const delta of provider.chatStream(messages, { signal })) {
    raw += delta;
    if (metadataStarted) continue;

    // 元数据区起点（围栏 1-3 个反引号，或裸 JSON 的 { "confidence"/"evidence"）
    const start = findMetadataStart(raw);
    if (start !== -1) {
      metadataStarted = true;
      flushVisible(start);
    } else {
      flushVisible(Math.max(0, raw.length - SAFE_TAIL));
    }
  }

  // 流结束且从未进入元数据区 → flush 剩余可见文本
  if (!metadataStarted) flushVisible(raw.length);

  const { text, confidence, evidence, addressedCriticIds } =
    parseStructuredOutput(raw);
  return {
    text,
    confidence,
    evidence: normalizeEvidence(evidence, inputText),
    addressedCriticIds,
  };
}
