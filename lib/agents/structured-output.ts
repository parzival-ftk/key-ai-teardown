import { z } from "zod";
import { EvidenceSchema, type Evidence } from "@/lib/types/agent";

/**
 * 结构化元数据解析（E2 证据标签）。
 *
 * Agent 被要求在回答末尾附加一个 JSON 代码块：
 * ```json
 * {"confidence": 80, "evidence": [{"claim": "...", "label": "inferred"}]}
 * ```
 * 本模块负责把它剥离出来并解析；解析失败时**降级**为纯文本（不抛错），
 * 保证任一 Agent 的输出异常都不会中断整条流水线。
 */

const MetadataSchema = z.object({
  confidence: z.number().min(0).max(100).optional(),
  evidence: z.array(EvidenceSchema).optional(),
});

export interface ParsedOutput {
  /** 剥离元数据块后的正文 */
  text: string;
  confidence?: number;
  evidence: Evidence[];
}

/** 匹配结尾的 ```json ... ``` 代码块 */
const TRAILING_JSON_BLOCK = /```json\s*([\s\S]*?)```\s*$/;

export function parseStructuredOutput(raw: string): ParsedOutput {
  const match = raw.match(TRAILING_JSON_BLOCK);
  if (!match || match.index === undefined) {
    return { text: raw.trim(), evidence: [] };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(match[1]);
  } catch {
    // 非法 JSON → 降级为纯文本
    return { text: raw.trim(), evidence: [] };
  }

  const result = MetadataSchema.safeParse(parsedJson);
  if (!result.success) {
    return { text: raw.trim(), evidence: [] };
  }

  return {
    text: raw.slice(0, match.index).trim(),
    confidence: result.data.confidence,
    evidence: result.data.evidence ?? [],
  };
}
