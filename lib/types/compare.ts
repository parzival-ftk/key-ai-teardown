import { z } from "zod";
import { ProductBriefSchema } from "./brief";

/**
 * 对比输入（W11 · 对比矩阵）—— 一次输入 2-3 个产品做并列对比。
 *
 * 上限 3 是**成本护栏**：LLM 调用数 ≈ 产品数 × 编队规模，随产品数线性上升，
 * 延迟也同步放大；2-3 个才是有意义的对比规模。
 */

export const MIN_COMPARE_PRODUCTS = 2;
export const MAX_COMPARE_PRODUCTS = 3;

/**
 * 对比官 Agent id（单一事实来源）。
 * 放在零依赖模块，供客户端组件轻量引用（不把编队/框架打进客户端 bundle）。
 */
export const COMPARISON_AGENT_ID = "comparison";
export const COMPARISON_AGENT_NAME = "对比官";

export const CompareBriefSchema = z.object({
  products: z
    .array(ProductBriefSchema)
    .min(MIN_COMPARE_PRODUCTS, `至少需要 ${MIN_COMPARE_PRODUCTS} 个产品`)
    .max(MAX_COMPARE_PRODUCTS, `最多支持 ${MAX_COMPARE_PRODUCTS} 个产品`),
});
export type CompareBrief = z.infer<typeof CompareBriefSchema>;

/** 严格解析，失败抛错 */
export function parseCompareBrief(input: unknown): CompareBrief {
  return CompareBriefSchema.parse(input);
}

/** 安全解析，返回 Result（用于边界处校验用户输入） */
export function safeParseCompareBrief(input: unknown) {
  return CompareBriefSchema.safeParse(input);
}
