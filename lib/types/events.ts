import { z } from "zod";
import { EvidenceSchema } from "./evidence";

/**
 * SSE 事件协议 —— 产品的心脏（设计规格 §5）。
 *
 * agent:start    → 前端对应 Agent 卡片亮起
 * agent:token    → 逐字流式输出
 * agent:done     → 卡片完成，可携带置信度
 * report:section → 报告某板块就绪
 * error          → 单 Agent 失败（不阻塞整体）
 * done           → 全流程结束
 */
export const AgentStartEventSchema = z.object({
  type: z.literal("agent:start"),
  agentId: z.string(),
  name: z.string(),
});

export const AgentTokenEventSchema = z.object({
  type: z.literal("agent:token"),
  agentId: z.string(),
  delta: z.string(),
});

export const AgentDoneEventSchema = z.object({
  type: z.literal("agent:done"),
  agentId: z.string(),
  output: z.string(),
  /** 置信度 0-100（PM 综合官产出；MVP 阶段可缺省） */
  confidence: z.number().min(0).max(100).optional(),
  /** 证据标签（E2） */
  evidence: z.array(EvidenceSchema).optional(),
});

export const ReportSectionEventSchema = z.object({
  type: z.literal("report:section"),
  section: z.string(),
  content: z.string(),
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  agentId: z.string().optional(),
  message: z.string(),
});

export const DoneEventSchema = z.object({
  type: z.literal("done"),
  analysisId: z.string().optional(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  AgentStartEventSchema,
  AgentTokenEventSchema,
  AgentDoneEventSchema,
  ReportSectionEventSchema,
  ErrorEventSchema,
  DoneEventSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentStartEvent = z.infer<typeof AgentStartEventSchema>;
export type AgentTokenEvent = z.infer<typeof AgentTokenEventSchema>;
export type AgentDoneEvent = z.infer<typeof AgentDoneEventSchema>;
export type ReportSectionEvent = z.infer<typeof ReportSectionEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;

/** 严格解析事件（内部路径） */
export function parseAgentEvent(input: unknown): AgentEvent {
  return AgentEventSchema.parse(input);
}

/** 类型守卫（前端消费原始字符串时使用） */
export function isAgentEvent(input: unknown): input is AgentEvent {
  return AgentEventSchema.safeParse(input).success;
}

/** 序列化为 SSE wire 格式：`data: <json>\n\n` */
export function serializeAgentEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * 解析 SSE wire 行（`data: <json>`）为事件对象；非法/空行返回 null。
 * 与 serializeAgentEvent 构成往返对。
 */
export function deserializeAgentEvent(line: string): AgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload) return null;
  try {
    const parsed = AgentEventSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
