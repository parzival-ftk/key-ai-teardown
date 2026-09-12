import type { Agent } from "@/lib/types/agent";
import type { ChatMessage } from "@/lib/llm/provider";
import type { FrameworkTemplate } from "@/lib/frameworks";
import type { ProductBrief } from "@/lib/types/brief";
import {
  parseStructuredOutput,
  findMetadataStart,
  normalizeEvidence,
} from "./structured-output";

/**
 * 归一化用的「本次输入文本」（W1）：机械核验 evidence.source 是否出自用户输入。
 * 注意：截图源无文本子串可追溯 → 其所有 verified 会被降级为 inferred
 * （有意设计：图片内容无法机械核验，就不给 verified）。
 */
function buildInputText(brief: ProductBrief): string {
  return [brief.name, brief.description, brief.rawText].join("\n");
}

/**
 * 框架驱动的 Agent 工厂 —— 把「分析框架」与「执行逻辑」解耦（spec §6/§7）。
 * 一个 Agent 可绑定多个框架（其提示词与用户消息依次拼接，单次 LLM 调用产出）。
 */

export interface FrameworkAgentConfig {
  id: string;
  name: string;
  description: string;
  /** 该 Agent 使用的分析框架（按顺序拼接） */
  frameworks: FrameworkTemplate[];
  /** 显式依赖（W10）：传给编排层，收窄该 Agent 看到的 priorResults */
  dependsOn?: string[];
}

/** 流式阶段为「元数据起点」保留的安全尾长（覆盖最长的可能前缀，避免吐半截） */
const SAFE_TAIL = 16;

export function createFrameworkAgent({
  id,
  name,
  description,
  frameworks,
  dependsOn,
}: FrameworkAgentConfig): Agent {
  if (frameworks.length === 0) {
    throw new Error(`Agent ${id} 至少需要一个框架`);
  }

  const systemPrompt = frameworks
    .map((f) => f.systemPrompt)
    .join("\n\n---\n\n");

  return {
    id,
    name,
    description,
    dependsOn,
    async run(brief, ctx) {
      const userText = frameworks
        .map((f) => f.userPrompt(brief, ctx.priorResults))
        .join("\n\n");

      // 截图输入（Wave 4.2）：把图片作为多模态分片附加到用户消息，
      // 由 Vision 模型识别。纯文本输入时 content 保持为字符串。
      const userContent: ChatMessage["content"] = brief.screenshotDataUrl
        ? [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: brief.screenshotDataUrl } },
          ]
        : userText;

      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];

      let raw = "";
      let emitted = 0;
      let metadataStarted = false;

      const flushVisible = (upTo: number) => {
        if (upTo <= emitted) return;
        const delta = raw.slice(emitted, upTo);
        emitted = upTo;
        if (delta) ctx.emit({ type: "agent:token", agentId: id, delta });
      };

      for await (const delta of ctx.provider.chatStream(messages, {
        signal: ctx.signal,
      })) {
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

      // 剥离结构化元数据（置信度 + 证据标签）；解析失败自动降级为纯文本
      const { text, confidence, evidence } = parseStructuredOutput(raw);

      return {
        agentId: id,
        output: text,
        confidence,
        // W1：把「假引用」（verified 但来源无法追溯回本次输入）自动降级为 inferred
        evidence: normalizeEvidence(evidence, buildInputText(brief)),
        failed: false,
      };
    },
  };
}
