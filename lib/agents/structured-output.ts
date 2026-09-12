import { z } from "zod";
import { EvidenceSchema, type Evidence } from "@/lib/types/agent";

/**
 * 结构化元数据解析（E2 证据标签）。
 *
 * Agent 被要求在回答末尾附加一个 JSON 块：
 *     ```json
 *     {"confidence": 80, "evidence": [{"claim": "...", "label": "inferred"}]}
 *     ```
 *
 * 但真实模型不总是守约（实测 DeepSeek 有时只写 1 个反引号），因此解析分三级降级：
 *   1) 结尾代码块（容忍 1-3 个反引号）
 *   2) 无围栏时的末尾裸 JSON 对象
 *   3) 都不行 → 纯文本（不抛错）
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

/** 结尾代码块：1-3 个反引号 + json，内容非贪婪，尾部同样 1-3 个反引号 */
const FENCE_BLOCK = /`{1,3}json\s*([\s\S]*?)`{1,3}\s*$/i;

type Metadata = { confidence?: number; evidence: Evidence[] };

function tryParseMetadata(candidate: string): Metadata | null {
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    return null;
  }
  const parsed = MetadataSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    confidence: parsed.data.confidence,
    evidence: parsed.data.evidence ?? [],
  };
}

/** 从后往前扫出末尾配对的 JSON 对象（仅当它含 confidence/evidence 关键词时才认） */
function extractTrailingJsonObject(
  text: string,
): { index: number; json: string } | null {
  const end = text.lastIndexOf("}");
  if (end === -1) return null;

  let depth = 0;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) {
        const json = text.slice(i, end + 1);
        if (/"confidence"|"evidence"/.test(json)) return { index: i, json };
        return null;
      }
    }
  }
  return null;
}

export function parseStructuredOutput(raw: string): ParsedOutput {
  const trimmed = raw.trim();

  // 1) 结尾代码块（容忍反引号数量不规范）
  const fence = FENCE_BLOCK.exec(trimmed);
  if (fence && fence.index !== undefined) {
    const meta = tryParseMetadata(fence[1]);
    if (meta) {
      return {
        text: trimmed.slice(0, fence.index).trim(),
        confidence: meta.confidence,
        evidence: meta.evidence,
      };
    }
  }

  // 2) 兜底：末尾裸 JSON 对象
  const bare = extractTrailingJsonObject(trimmed);
  if (bare) {
    const meta = tryParseMetadata(bare.json);
    if (meta) {
      return {
        text: trimmed.slice(0, bare.index).trim(),
        confidence: meta.confidence,
        evidence: meta.evidence,
      };
    }
  }

  // 3) 降级为纯文本
  return { text: trimmed, evidence: [] };
}

/** 供流式剥离使用：定位元数据区起点（返回 -1 表示尚未出现） */
export function findMetadataStart(text: string): number {
  const fence = /`{1,3}json/i.exec(text);
  if (fence && fence.index !== undefined) return fence.index;

  const bare = /[{[,]\s*"(confidence|evidence)"\s*:/.exec(text);
  return bare && bare.index !== undefined ? bare.index : -1;
}
