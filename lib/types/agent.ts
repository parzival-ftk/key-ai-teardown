import { z } from "zod";
import type { ProductBrief } from "./brief";
import type { AgentEvent } from "./events";
import type { LLMProvider } from "../llm/provider";

/**
 * 证据标签（E2 · 差异化卖点）。
 * 每条结论标注其证据等级，用于治理 LLM 幻觉：
 * - verified：有明确来源支撑
 * - inferred：由推理得出，无直接来源
 * - missing：关键信息缺失，无法判断
 */
export const EvidenceLabelSchema = z.enum(["verified", "inferred", "missing"]);
export type EvidenceLabel = z.infer<typeof EvidenceLabelSchema>;

export const EvidenceSchema = z.object({
  /** 结论/声称内容 */
  claim: z.string(),
  /** 证据等级 */
  label: EvidenceLabelSchema,
  /** 来源（URL / 文档 / 数据点）；label = verified 时应有来源 */
  source: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

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
  run(brief: ProductBrief, ctx: AgentContext): Promise<AgentResult>;
}
