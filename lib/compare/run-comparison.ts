import { runAnalysis } from "@/lib/agents/orchestrator";
import {
  createDefaultAgents,
  DEFAULT_PARALLEL_AGENT_IDS,
} from "@/lib/agents/analysis-stream";
import { runCompletionStream } from "@/lib/agents/completion-stream";
import { formatPriorResults } from "@/lib/agents/prior-context";
import {
  buildComparisonUserPrompt,
  comparisonSystemPrompt,
} from "@/lib/frameworks/comparison";
import { runWithConcurrency } from "./concurrency";
import {
  COMPARISON_AGENT_ID,
  COMPARISON_AGENT_NAME,
  type CompareBrief,
} from "@/lib/types/compare";
import type { Agent, AgentResult } from "@/lib/types/agent";
import type { ProductBrief } from "@/lib/types/brief";
import type { AgentEvent } from "@/lib/types/events";
import type { Evidence } from "@/lib/types/evidence";
import type { ChatMessage, LLMProvider } from "@/lib/llm/provider";

/**
 * 对比矩阵编排（W11）。
 *
 * 两阶段：
 *   阶段一 —— fan-out：每个产品各跑一遍完整编队（复用 createDefaultAgents + runAnalysis），
 *             并发受 runWithConcurrency 限制，避免 N 个编队同时打满上游。
 *   阶段二 —— 对比官：把所有产品报告拼进一次补全，产出并列对比矩阵。
 *
 * 多产品事件同一流内用 agentId 命名空间区分（`p<index>:<agentId>`），对比官用 `comparison`。
 * 成本护栏：LLM 调用数 ≈ 产品数 × 编队规模 + 1。
 */

export { COMPARISON_AGENT_ID, COMPARISON_AGENT_NAME };

export interface ProductRunResult {
  product: ProductBrief;
  sections: AgentResult[];
}

export interface ComparisonOutcome {
  products: ProductRunResult[];
  comparison: {
    output: string;
    evidence: Evidence[];
    confidence?: number;
    failed: boolean;
    error?: string;
  };
}

export interface RunComparisonOptions {
  provider: LLMProvider;
  /** 同时进行的产品数上限（默认 2）：成本 / 速率护栏 */
  concurrency?: number;
  signal?: AbortSignal;
  /** 复用/注入编队（测试用） */
  agents?: Agent[];
  parallel?: string[];
}

/** 把某产品的 Agent id 加命名空间，使多产品事件在同一 SSE 流里可区分 */
export function productAgentId(index: number, agentId: string): string {
  return `p${index}:${agentId}`;
}

/** 单产品报告的文本化（供对比官消费）；跳过失败 / 空段 */
export function buildProductReportText(sections: AgentResult[]): string {
  return formatPriorResults(
    sections.filter((s) => !s.failed && s.output.trim() !== ""),
  );
}

function namespaceEmit(
  index: number,
  emit: (event: AgentEvent) => void,
): (event: AgentEvent) => void {
  return (event) => {
    switch (event.type) {
      case "agent:start":
        emit({
          type: "agent:start",
          agentId: productAgentId(index, event.agentId),
          name: event.name,
        });
        break;
      case "agent:token":
        emit({
          type: "agent:token",
          agentId: productAgentId(index, event.agentId),
          delta: event.delta,
        });
        break;
      case "agent:done":
        emit({
          type: "agent:done",
          agentId: productAgentId(index, event.agentId),
          output: event.output,
          confidence: event.confidence,
          evidence: event.evidence,
          // W15/W16 新增字段必须一并透传，否则命名空间化会把它们吃掉
          addressedCriticIds: event.addressedCriticIds,
          dimensionScores: event.dimensionScores,
        });
        break;
      case "error":
        emit({
          type: "error",
          agentId: event.agentId
            ? productAgentId(index, event.agentId)
            : undefined,
          message: event.message,
        });
        break;
      case "done":
        // 单产品编队不发顶层 done；整体结束由 stream 层统一发
        break;
    }
  };
}

export async function runComparison(
  compareBrief: CompareBrief,
  options: RunComparisonOptions,
  emit: (event: AgentEvent) => void,
): Promise<ComparisonOutcome> {
  const { provider, signal } = options;
  const agents = options.agents ?? createDefaultAgents();
  const parallel = options.parallel ?? DEFAULT_PARALLEL_AGENT_IDS;
  const concurrency = options.concurrency ?? 2;

  // 阶段一：每个产品各跑一遍完整编队（并发受限，结果按输入同序）
  const products = await runWithConcurrency(
    compareBrief.products,
    concurrency,
    async (product, index): Promise<ProductRunResult> => {
      const sections = await runAnalysis(
        product,
        { provider, agents, parallel, signal },
        namespaceEmit(index, emit),
      );
      return { product, sections };
    },
  );

  // 阶段二：把各产品报告交给对比官做横向对比（单次补全）
  const comparisonInput = products.map((p) => ({
    name: p.product.name,
    reportText: buildProductReportText(p.sections),
  }));
  const messages: ChatMessage[] = [
    { role: "system", content: comparisonSystemPrompt },
    { role: "user", content: buildComparisonUserPrompt(comparisonInput) },
  ];

  emit({
    type: "agent:start",
    agentId: COMPARISON_AGENT_ID,
    name: COMPARISON_AGENT_NAME,
  });
  try {
    const result = await runCompletionStream({
      provider,
      messages,
      agentId: COMPARISON_AGENT_ID,
      emit,
      signal,
      // 证据归一化的输入 = 各产品报告文本（对比官只能追溯回它读到的东西）
      inputText: comparisonInput
        .map((p) => `${p.name}\n${p.reportText}`)
        .join("\n\n"),
    });
    emit({
      type: "agent:done",
      agentId: COMPARISON_AGENT_ID,
      output: result.text,
      confidence: result.confidence,
      evidence: result.evidence.length > 0 ? result.evidence : undefined,
    });
    return {
      products,
      comparison: {
        output: result.text,
        evidence: result.evidence,
        confidence: result.confidence,
        failed: false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    emit({ type: "error", agentId: COMPARISON_AGENT_ID, message });
    return {
      products,
      comparison: { output: "", evidence: [], failed: true, error: message },
    };
  }
}
