import { runComparison } from "./run-comparison";
import { serializeAgentEvent, type AgentEvent } from "@/lib/types/events";
import type { CompareBrief } from "@/lib/types/compare";
import type { LLMProvider } from "@/lib/llm/provider";

/**
 * 对比流的 SSE 封装（W11）—— 与 createAnalysisStream 同构，便于注入 stub 做集成测试。
 */

export interface ComparisonStreamOptions {
  provider: LLMProvider;
  concurrency?: number;
  signal?: AbortSignal;
}

export function createComparisonStream(
  compareBrief: CompareBrief,
  options: ComparisonStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(serializeAgentEvent(event)));
      };
      try {
        await runComparison(
          compareBrief,
          {
            provider: options.provider,
            concurrency: options.concurrency,
            signal: options.signal,
          },
          emit,
        );
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "未知错误",
        });
      } finally {
        emit({ type: "done" });
        controller.close();
      }
    },
  });
}
