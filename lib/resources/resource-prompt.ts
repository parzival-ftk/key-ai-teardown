import {
  RESOURCE_CATEGORY_IDS,
  RESOURCE_CATEGORY_LABELS,
  RESOURCE_DESCRIPTION_MAX,
  RESOURCE_ID_RULE,
  type ResourceCategoryId,
} from "./ui-resources";

/**
 * UI 资源库的**扩充提示词**（Master Prompt，W28）。
 *
 * 用途：把「新网址 / 资源描述」交给模型，产出符合 `lib/resources/ui-resources.json`
 * 契约的资源条目。产出的 JSON 再经 `parseResourceItem` 校验、`appendResourceItem`
 * 追加、`serializeResourceDataset` 序列化，即可贴回数据文件 —— 运行时无法写仓库文件，
 * 所以这条链是**作者工作流**（本模块 + ui-resources 的校验/序列化函数共同保证其可用）。
 *
 * 提示词用字符串数组 join 构造：正文里会出现 JSON 片段与引号，数组形式改动更安全。
 */

const CATEGORY_LINES = RESOURCE_CATEGORY_IDS.map(
  (id: ResourceCategoryId) => `- ${id}（${RESOURCE_CATEGORY_LABELS[id]}）`,
).join("\n");

export const RESOURCE_EXTRACTION_SYSTEM_PROMPT = [
  "你是一个在 AI Product Manager 助手体系（Key）中专门负责【UI/UX 资源整合与视觉范式提取】的专家模块。",
  "",
  "你的任务：接收输入的网址或 UI 资源描述，对其进行结构化分类与标签提炼，",
  "产出一条（或一批）符合下方契约的资源条目。",
  "",
  "【分类】必须落在以下 5 个分类之一，使用英文 id，不要新造分类：",
  CATEGORY_LINES,
  "",
  "【标签】恰好 4 个，分别覆盖：核心功能 / 技术或风格 / 适用场景 / 特色。",
  "中文优先，专有名词保留原文（如 Tailwind、WebGL、React/Vue）。",
  "优先复用「已有标签」列表里的词，避免同义异名（如「组件库」与「UI组件库」并存）。",
  "",
  `【简介】一句话，不超过 ${RESOURCE_DESCRIPTION_MAX} 字，说清它解决什么痛点。`,
  "",
  `【id】${RESOURCE_ID_RULE}，由名称转写而来，且不得与已收录 id 重复。`,
  "",
  "【输出格式】只输出一个 JSON 数组，不要解释文字、不要 Markdown 围栏：",
  '[ { "id": "…", "name": "…", "url": "…", "tags": ["…", "…", "…", "…"], "description": "…" } ]',
  "",
  "【事实纪律】不要臆造网址或功能；无法确认的条目宁缺毋滥（整条会被校验丢弃）。",
  "",
  "【关于导航组件】本仓已有 components/resources/ResourceNav.tsx（分类 Tabs + 关键字实时搜索 +",
  "单列/双列/三列响应式卡片网格 + 悬停上浮 + 暗色模式高亮边框 + 标签 Badge +",
  '外链 target="_blank" rel="noopener noreferrer"）。除非明确要求「重建组件」，',
  "否则不要重复生成组件代码，只产出数据条目。",
].join("\n");

export interface ResourceExtractionInput {
  /** 待处理的网址 / 网页描述，每行一条 */
  sources: string;
  /** 已收录的资源 id（避免重复扩充） */
  existingIds?: readonly string[];
  /** 已收录的标签词汇（要求模型优先复用，避免同义异名） */
  existingTags?: readonly string[];
}

/**
 * 组装完整的扩充提示词：系统规范 + 已收录 id + 已用标签 + 待处理来源。
 * 待处理来源为空时给出明确占位提示，而不是生成一条会让模型空转的 prompt。
 */
export function buildResourceExtractionPrompt(input: ResourceExtractionInput): string {
  const sources = (input.sources ?? "").trim();
  const ids = (input.existingIds ?? []).map((id) => id.trim()).filter(Boolean);
  const tags = (input.existingTags ?? []).map((tag) => tag.trim()).filter(Boolean);

  const sections = [RESOURCE_EXTRACTION_SYSTEM_PROMPT];

  if (ids.length > 0) {
    sections.push(
      "",
      "【已收录 id（新条目不得与之重复）】",
      ids.join(", "),
    );
  }

  if (tags.length > 0) {
    sections.push(
      "",
      "【已有标签（能复用就复用，不要造同义词）】",
      tags.join(" / "),
    );
  }

  sections.push(
    "",
    "【待处理的数据源 / 网址】",
    sources === "" ? "（未提供待处理来源，请等待我粘贴网址或资源描述）" : sources,
  );

  return sections.join("\n");
}
