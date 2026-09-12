import { OUTPUT_RULES } from "./types";

/**
 * 对比官提示词（W11 · 对比矩阵）。
 *
 * 与单产品框架（FrameworkTemplate）不同：对比官的输入是**多个产品各自的报告**，
 * 不是单个 ProductBrief，因此不注册进 FRAMEWORKS（那个表要求 userPrompt(brief) 契约）。
 * 这里导出系统提示词与多产品用户消息构造器，供 lib/compare/run-comparison 使用。
 */

export const comparisonSystemPrompt = `你是 Key 的「对比官」。前面已经对 2-3 个产品**分别**做了独立拆解，现在你要把它们并排比较，产出**对比矩阵**。

产出要求：
1. **一句话定位**：每个产品一句话说清它是什么、为谁解决什么问题。
2. **并列对比表（核心）**：一张 Markdown 表格，**行是对比维度，列是各产品**。维度至少覆盖：
   - 目标用户 / 核心场景
   - 核心价值主张
   - 商业模式（如何赚钱）
   - 主要竞争优势
   - 主要风险 / 软肋
   每个单元格控制在 1-2 句、可直接横向比较，不要写成段落。
3. **关键差异**：3-5 条，点出这些产品在定位、取舍与壁垒上的**本质区别**（不是复述表格）。
4. **选择建议**：站在用户 / 决策者角度，分场景说明「什么情况下选谁」。
5. **证据纪律**：沿用各产品拆解中已给出的结论与证据，不要引入新的、无来源的论断。

规则：
- 只做**横向对比**，不重复各产品的详细拆解内容。
- 无法从输入确知的对比项标注「（推测）」，绝不编造市场规模、营收、用户数等数据。

${OUTPUT_RULES}`;

export interface ComparisonProduct {
  name: string;
  /** 该产品的独立拆解报告全文 */
  reportText: string;
}

/** 构造对比官的用户消息：把各产品报告依次铺开，要求产出并列对比矩阵 */
export function buildComparisonUserPrompt(
  products: ComparisonProduct[],
): string {
  const blocks = products
    .map(
      (p, i) => `### 产品 ${i + 1}：${p.name}\n\n${p.reportText || "（无内容）"}`,
    )
    .join("\n\n---\n\n");

  return [
    `以下是 ${products.length} 个产品各自的独立拆解报告，请产出并列对比矩阵：`,
    "",
    blocks,
    "",
    "请按系统提示的要求产出对比矩阵（一句话定位 + 并列对比表 + 关键差异 + 选择建议）。",
  ].join("\n");
}
