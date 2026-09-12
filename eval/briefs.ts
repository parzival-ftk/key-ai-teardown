import { parseProductBrief, type ProductBrief } from "@/lib/types/brief";

/**
 * 质量门禁 eval —— golden briefs。
 *
 * 固定的「黄金输入集」：同一组输入跨运行不变，使前后两次 eval 的分数可比。
 * 选取原则：品类不同（工具 / 消费 / 设计），且都是可公开描述的产品，
 * 避免依赖实时数据（否则分数会因外部世界变化而漂移，干扰对「改动效果」的判断）。
 */

export interface GoldenBrief {
  id: string;
  brief: ProductBrief;
}

export const GOLDEN_BRIEFS: GoldenBrief[] = [
  {
    id: "notion",
    brief: parseProductBrief({
      name: "Notion",
      description:
        "一体化工作空间：把文档、数据库、看板与 Wiki 合一，面向中小团队与个人知识管理。核心卖点是高度可组合的区块式内容模型与模板生态。",
      source: "text",
    }),
  },
  {
    id: "duolingo",
    brief: parseProductBrief({
      name: "Duolingo",
      description:
        "游戏化语言学习应用，以连续打卡（streak）、排行榜、短课节与即时反馈驱动每日学习习惯，核心是学习动机设计而非教学内容本身。",
      source: "text",
    }),
  },
  {
    id: "figma",
    brief: parseProductBrief({
      name: "Figma",
      description:
        "浏览器端协同设计工具：多人实时编辑同一文件、组件库与设计 token、设计-开发交接一体化，把设计资产变成可协作的在线对象。",
      source: "text",
    }),
  },
];
