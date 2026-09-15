import type { Agent } from "@/lib/types/agent";
import type { ChatMessage } from "@/lib/llm/provider";
import type { FrameworkTemplate } from "@/lib/frameworks";
import type { ProductBrief } from "@/lib/types/brief";
import { runCompletionStream } from "./completion-stream";

/**
 * 归一化用的「本次输入文本」（W1）：机械核验 evidence.source 是否出自用户输入。
 * 注意：截图源无文本子串可追溯 → 其所有 verified 会被降级为 inferred
 * （有意设计：图片内容无法机械核验，就不给 verified）。
 */
function buildInputText(brief: ProductBrief): string {
  return [brief.name, brief.description, brief.rawText, brief.uiStructure].join(
    "\n",
  );
}

/**
 * 框架驱动的 Agent 工厂 —— 把「分析框架」与「执行逻辑」解耦（spec §6/§7）。
 * 一个 Agent 可绑定多个框架（其提示词与用户消息依次拼接，单次 LLM 调用产出）。
 *
 * 流式 + 结构化解析逻辑抽到 completion-stream（W10/W11 与对比官共用）。
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

      const { text, confidence, evidence, addressedCriticIds } =
        await runCompletionStream({
          provider: ctx.provider,
          messages,
          agentId: id,
          emit: ctx.emit,
          signal: ctx.signal,
          inputText: buildInputText(brief),
        });

      return {
        agentId: id,
        output: text,
        confidence,
        evidence,
        // W15：PRD 声明回应的质疑 id（其它 Agent 为空数组 → 不写入）
        addressedCriticIds:
          addressedCriticIds.length > 0 ? addressedCriticIds : undefined,
        failed: false,
      };
    },
  };
}
