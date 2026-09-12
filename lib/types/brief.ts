import { z } from "zod";

/**
 * 输入来源类型 —— 对应解析层的四条输入通道。
 */
export const InputSourceSchema = z.enum(["text", "url", "screenshot", "pdf"]);
export type InputSource = z.infer<typeof InputSourceSchema>;

/**
 * 双模式：拆解（teardown）/ 共创（co-create）。
 * 见设计规格 §2。
 */
export const ModeSchema = z.enum(["teardown", "co-create"]);
export type Mode = z.infer<typeof ModeSchema>;

/**
 * ProductBrief —— 异构输入统一后的产品简报。
 * 输入层（文本 / URL / 截图 / PDF）经解析层归一到此结构，供编排层与各 Agent 消费。
 */
export const ProductBriefSchema = z.object({
  /** 产品名称（必填） */
  name: z.string().min(1, "产品名称不能为空"),
  /** 产品描述 / 想法正文 */
  description: z.string().default(""),
  /** 分析模式 */
  mode: ModeSchema.default("teardown"),
  /** 来源类型 */
  source: InputSourceSchema.default("text"),
  /** 解析后的原文文本（URL 抓取 / PDF 抽取 / 截图 OCR 的产物） */
  rawText: z.string().default(""),
  /** 来源 URL（source = url 时存在） */
  sourceUrl: z.string().optional(),
  /** 截图 data URL（source = screenshot 时存在） */
  screenshotDataUrl: z.string().optional(),
  /**
   * 无头渲染得到的「UI 结构（DOM + computed styles）」描述（W8）。
   * source = url 且本机有 Chrome/Edge 时由 /api/parse 产出；否则为空串（降级为纯文本）。
   */
  uiStructure: z.string().default(""),
  /** 额外上下文（可选） */
  extraContext: z.string().optional(),
});

export type ProductBrief = z.infer<typeof ProductBriefSchema>;

/** 严格解析，失败抛错（用于内部已知合法的路径） */
export function parseProductBrief(input: unknown): ProductBrief {
  return ProductBriefSchema.parse(input);
}

/** 安全解析，返回 Result（用于边界处校验用户输入） */
export function safeParseProductBrief(input: unknown) {
  return ProductBriefSchema.safeParse(input);
}
