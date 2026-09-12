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
      for await (const delta of ctx.provider.chatStream(messages, {
        signal: ctx.signal,
      })) {
        raw += delta;
        ctx.emit({ type: "agent:token", agentId: id, delta });
      }

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
