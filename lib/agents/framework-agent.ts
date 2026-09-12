import type { Agent } from "@/lib/types/agent";
import type { ChatMessage } from "@/lib/llm/provider";
import type { FrameworkTemplate } from "@/lib/frameworks";
import { parseStructuredOutput } from "./structured-output";

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
}

/** 结构化元数据块的起始围栏 —— 内容是给机器读的，不应流式展示给用户 */
const METADATA_FENCE = "```json";

export function createFrameworkAgent({
  id,
  name,
  description,
  frameworks,
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
    async run(brief, ctx) {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: frameworks
            .map((f) => f.userPrompt(brief, ctx.priorResults))
            .join("\n\n"),
        },
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

        const fenceIndex = raw.indexOf(METADATA_FENCE);
        if (fenceIndex !== -1) {
          // 进入元数据区：只发出围栏之前的正文，之后不再 emit token
          metadataStarted = true;
          flushVisible(fenceIndex);
        } else {
          // 保留尾部（可能是围栏前缀，避免把 ``` 提前吐给用户）
          flushVisible(Math.max(0, raw.length - (METADATA_FENCE.length - 1)));
        }
      }

      // 流结束且从未进入元数据区 → flush 剩余可见文本
      if (!metadataStarted) flushVisible(raw.length);

      // 剥离结尾结构化元数据（置信度 + 证据标签）；解析失败自动降级为纯文本
      const { text, confidence, evidence } = parseStructuredOutput(raw);

      return {
        agentId: id,
        output: text,
        confidence,
        evidence,
        failed: false,
      };
    },
  };
}
