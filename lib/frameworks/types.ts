import type { ProductBrief } from "@/lib/types/brief";
import type { AgentResult } from "@/lib/types/agent";

/**
 * 分析框架模板 —— 提示词与执行逻辑分离（spec §6）。
 * 每个框架是一个纯数据单元：系统提示词 + 用户消息构造器，可独立测试。
 */
export interface FrameworkTemplate {
  /** 唯一标识，如 "five-forces" */
  id: string;
  /** 展示名，如 "波特五力" */
  name: string;
  /** 一句话说明 */
  description: string;
  /** 系统提示词（角色设定 + 输出契约） */
  systemPrompt: string;
  /** 根据产品简报（及可选的前序分析结果）生成用户消息 */
  userPrompt: (brief: ProductBrief, priorResults?: AgentResult[]) => string;
}

/** 共用：把 ProductBrief 渲染为分析上下文文本 */
export function renderBrief(brief: ProductBrief): string {
  return [
    brief.mode === "co-create"
      ? "（以下是一个尚未落地的产品想法，请按潜在产品推演其市场）"
      : "",
    `产品名称：${brief.name}`,
    brief.description ? `产品描述：${brief.description}` : "",
    brief.rawText ? `补充资料：${brief.rawText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 共用输出纪律，附加到各框架系统提示词末尾 */
export const OUTPUT_RULES = `规则：
- 使用中文、Markdown 输出，结构清晰。
- 不要编造具体的市场规模、营收、用户数等数据；无法确知处明确标注「（推测）」。
- 只做分析，不写代码，不输出与本次分析无关的内容。`;
