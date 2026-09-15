import { z } from "zod";
import type { ProductBrief } from "./brief";
import type { AgentEvent } from "./events";
import type { LLMProvider } from "../llm/provider";
import { EvidenceSchema } from "./evidence";

// 证据标签类型统一由 ./evidence 定义，此处 re-export 以保持既有引用可用
export {
  EvidenceLabelSchema,
  EvidenceSchema,
} from "./evidence";
export type { EvidenceLabel, Evidence } from "./evidence";

/**
 * Agent 输出契约（spec §6：每个 Agent 有明确的 I/O 契约）。
 */
export const AgentResultSchema = z.object({
  agentId: z.string(),
  /** 面向报告的自然语言输出 */
  output: z.string(),
  /** 置信度 0-100（可选，MVP 阶段 PM 综合官才填） */
  confidence: z.number().min(0).max(100).optional(),
  /** 证据标签列表 */
  evidence: z.array(EvidenceSchema).default([]),
  /** W15：该 Agent 声明回应的质疑 id（PRD 撰写官产出；其它 Agent 缺省） */
  addressedCriticIds: z.array(z.string()).optional(),
  /** W16：竞品维度打分（竞品分析师 / 对比官产出；其它 Agent 缺省） */
  dimensionScores: z.record(z.string(), z.number()).optional(),
  /** 各 Agent 特有的结构化数据 */
  data: z.unknown().optional(),
  /** 是否失败（不阻塞整体，见 spec §8） */
  failed: z.boolean().default(false),
  /** 失败原因 */
  error: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

/**
 * Agent 运行上下文 —— 依赖注入（provider + 事件发射器）。
 * Agent 是纯函数式单元（spec §7），可脱离 UI / 网络独立测试。
 */
export interface AgentContext {
  provider: LLMProvider;
  /** 发射 SSE 事件（agent:start / token / done） */
  emit: (event: AgentEvent) => void;
  /** 前序 Agent 的结果（辩论/综合类 Agent 依赖它，如反方质疑官读前三者输出） */
  priorResults?: AgentResult[];
  signal?: AbortSignal;
}

/**
 * Agent 接口 —— 输入 ProductBrief + 上下文，输出 AgentResult。
 */
export interface Agent {
  /** 唯一标识，如 "market" */
  id: string;
  /** 展示名，如 "竞品分析师" */
  name: string;
  /** 一句话职责描述 */
  description: string;
  /**
   * 显式依赖（W10）—— 本 Agent 只读取这些 Agent 的结果作为 priorResults。
   *
   * 省略时保持旧语义：并行组（见 OrchestratorOptions.parallel）视为无依赖，
   * 其余按「依赖其之前声明的全部 Agent」串行执行。声明了 dependsOn 的 Agent
   * 只看到所列依赖的结果（更窄的上下文），用于表达「访谈官只依赖研究员」这类关系。
   */
  dependsOn?: string[];
  run(brief: ProductBrief, ctx: AgentContext): Promise<AgentResult>;
}
