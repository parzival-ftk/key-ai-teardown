import rawDataset from "./ui-resources.json";

/**
 * 内置 UI 资源库（W28）—— 外部设计资源的**结构化数据源**。
 *
 * 定位：这不是模型产出，而是仓库内置的「可交互工具/数据源」。
 * `ui-resources.json` 是唯一的存储，本模块负责：
 *   - 类型与分类常量（单一事实来源，Prompt 模板共用同一份分类 id）；
 *   - 规范化：把外部数据收敛成可信结构（标签去空白、分类排序、丢弃非法项）；
 *   - 检索：分类筛选 + 关键字实时搜索（纯函数，可脱离 UI 单测）；
 *   - 扩充闭环：校验模型产出的单条资源 → 追加 → 序列化回 JSON 文本
 *     （供作者把结果贴回 `ui-resources.json`；运行时无法写仓库文件）。
 *
 * 纪律：解析/检索路径**绝不抛错**（非法项被丢弃并计入 errors，由防漂移测试兜底）。
 */

export const RESOURCE_CATEGORY_IDS = [
  "components-and-motion",
  "inspiration-and-trends",
  "system-and-naming",
  "backgrounds-and-textures",
  "colors-and-icons",
] as const;

export type ResourceCategoryId = (typeof RESOURCE_CATEGORY_IDS)[number];

/** 分类 id → 中文名（数据集与 Prompt 共用） */
export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategoryId, string> = {
  "components-and-motion": "组件与动效",
  "inspiration-and-trends": "灵感与趋势",
  "system-and-naming": "规范与命名",
  "backgrounds-and-textures": "背景与纹理",
  "colors-and-icons": "色彩与图标",
};

/** 固定 4 个标签：核心功能 / 技术或风格 / 适用场景 / 特色 */
export type ResourceTags = [string, string, string, string];

/**
 * 简介字数上限 —— **单一事实来源**：校验器用它判定，Prompt 文本也引用它，
 * 两处不可能再各写一个数（此前 Prompt 写 20、校验器写 30，25 字的产出会违规通关）。
 */
export const RESOURCE_DESCRIPTION_MAX = 20;

/** id 契约（校验用） */
export const RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** id 契约（写进 Prompt 的人话版本，与上面的正则可被同一条测试锚定） */
export const RESOURCE_ID_RULE =
  "小写字母、数字与连字符（如 shadcn-ui），不得出现大写、下划线或空格";

/** 按码点计数（emoji 等代理对不会被算成两个字符） */
export function countChars(text: string): number {
  return [...(text ?? "")].length;
}

export interface ResourceItem {
  id: string;
  name: string;
  url: string;
  tags: ResourceTags;
  description: string;
}

export interface ResourceCategory {
  category: ResourceCategoryId;
  categoryName: string;
  items: ResourceItem[];
}

/** 「全部」在筛选语义上的哨兵值 */
export const ALL_CATEGORIES = "all" as const;

export function isResourceCategoryId(value: unknown): value is ResourceCategoryId {
  return (
    typeof value === "string" &&
    (RESOURCE_CATEGORY_IDS as readonly string[]).includes(value)
  );
}

/* ── 规范化 ── */

function toTags(raw: unknown): ResourceTags | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const tags = raw.map((tag) => (typeof tag === "string" ? tag.trim() : ""));
  if (tags.some((tag) => tag === "")) return null;
  return [tags[0], tags[1], tags[2], tags[3]];
}

function asNonEmptyString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text === "" ? null : text;
}

function toItem(raw: unknown): ResourceItem | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const id = asNonEmptyString(source.id);
  const name = asNonEmptyString(source.name);
  const url = asNonEmptyString(source.url);
  const description = asNonEmptyString(source.description);
  const tags = toTags(source.tags);
  if (!id || !name || !url || !description || !tags) return null;
  return { id, name, url, tags, description };
}

/** 把外部数据收敛成可信结构；返回被丢弃项的错误说明 */
export function normalizeResourceDataset(raw: unknown): {
  categories: ResourceCategory[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return { categories: [], errors: ["数据集顶层必须是数组"] };
  }

  const byCategory = new Map<ResourceCategoryId, ResourceItem[]>();
  const seenIds = new Set<string>();

  for (const group of raw) {
    if (!group || typeof group !== "object") {
      errors.push("分组不是对象，已丢弃");
      continue;
    }
    const record = group as Record<string, unknown>;
    if (!isResourceCategoryId(record.category)) {
      errors.push(`未知分类 id：${String(record.category)}`);
      continue;
    }
    if (byCategory.has(record.category)) {
      errors.push(`分类重复：${record.category}`);
      continue;
    }
    const bucket: ResourceItem[] = [];
    const items = Array.isArray(record.items) ? record.items : [];
    for (const entry of items) {
      const item = toItem(entry);
      if (!item) {
        errors.push(`分类 ${record.category} 中有非法资源项，已丢弃`);
        continue;
      }
      if (seenIds.has(item.id)) {
        errors.push(`资源 id 重复：${item.id}`);
        continue;
      }
      seenIds.add(item.id);
      bucket.push(item);
    }
    byCategory.set(record.category, bucket);
  }

  // 固定按分类常量排序，保证序列化结果稳定
  const categories: ResourceCategory[] = [];
  for (const id of RESOURCE_CATEGORY_IDS) {
    const items = byCategory.get(id);
    if (!items) continue;
    categories.push({ category: id, categoryName: RESOURCE_CATEGORY_LABELS[id], items });
  }
  return { categories, errors };
}

const NORMALIZED = normalizeResourceDataset(rawDataset as unknown);

/** 内置数据集（规范化后，引用稳定） */
export function loadResourceDataset(): ResourceCategory[] {
  return NORMALIZED.categories;
}

/** 内置数据集的规范化错误（正常应为空；供防漂移测试断言） */
export function resourceDatasetErrors(): string[] {
  return [...NORMALIZED.errors];
}

/* ── 检索 ── */

export interface ResourceFilter {
  /** 关键字：命中名称 / 简介 / 任一标签（大小写不敏感） */
  query?: string;
  category?: ResourceCategoryId | typeof ALL_CATEGORIES;
}

function matches(item: ResourceItem, needle: string): boolean {
  if (item.name.toLowerCase().includes(needle)) return true;
  if (item.description.toLowerCase().includes(needle)) return true;
  return item.tags.some((tag) => tag.toLowerCase().includes(needle));
}

/** 按分类与关键字筛选；空分组不返回。纯函数，不改动入参。 */
export function filterResources(
  dataset: ResourceCategory[],
  filter: ResourceFilter = {},
): ResourceCategory[] {
  const needle = (filter.query ?? "").trim().toLowerCase();
  const category = filter.category ?? ALL_CATEGORIES;
  const groups: ResourceCategory[] = [];
  for (const group of dataset) {
    if (category !== ALL_CATEGORIES && group.category !== category) continue;
    const items = needle
      ? group.items.filter((item) => matches(item, needle))
      : group.items;
    if (items.length === 0) continue;
    groups.push({ ...group, items });
  }
  return groups;
}

/** 数据集内全部标签（按出现顺序去重） */
export function collectTags(dataset: ResourceCategory[]): string[] {
  const tags: string[] = [];
  for (const group of dataset) {
    for (const item of group.items) {
      for (const tag of item.tags) {
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
  }
  return tags;
}

export function findResourceById(
  dataset: ResourceCategory[],
  id: string,
): ResourceItem | null {
  for (const group of dataset) {
    const hit = group.items.find((item) => item.id === id);
    if (hit) return hit;
  }
  return null;
}

export function countResources(dataset: ResourceCategory[]): number {
  return dataset.reduce((sum, group) => sum + group.items.length, 0);
}

/* ── 扩充闭环（配合 resource-prompt 的模型产出） ── */

export type ParseResourceItemResult =
  | { ok: true; item: ResourceItem }
  | { ok: false; errors: string[] };

/** 校验模型产出的单条资源（Prompt 的输出契约）；结构与内容规则都在这里强制 */
export function parseResourceItem(raw: unknown): ParseResourceItemResult {
  const item = toItem(raw);
  if (!item) {
    return {
      ok: false,
      errors: ["缺少 id / name / url / description，或 tags 不是 4 个非空字符串"],
    };
  }

  const errors: string[] = [];
  if (!RESOURCE_ID_PATTERN.test(item.id)) {
    errors.push(`id 不符合契约（${RESOURCE_ID_RULE}）：${item.id}`);
  }
  if (!/^https?:\/\//i.test(item.url)) {
    errors.push(`url 必须是 http(s)：${item.url}`);
  }
  const length = countChars(item.description);
  if (length > RESOURCE_DESCRIPTION_MAX) {
    errors.push(`简介需 ≤${RESOURCE_DESCRIPTION_MAX} 字（当前 ${length} 字）`);
  }
  return errors.length === 0 ? { ok: true, item } : { ok: false, errors };
}

export interface AppendResult {
  dataset: ResourceCategory[];
  appended: boolean;
  reason?: string;
}

/**
 * 把一条资源追加进指定分类（不可变，返回新数据集）。
 * id 重复 / 分类非法时**不追加**并给出原因（fail-loud，不静默吞掉）。
 */
export function appendResourceItem(
  dataset: ResourceCategory[],
  category: ResourceCategoryId,
  item: ResourceItem,
): AppendResult {
  if (!isResourceCategoryId(category)) {
    return { dataset, appended: false, reason: `未知分类 id：${category}` };
  }
  if (findResourceById(dataset, item.id)) {
    return { dataset, appended: false, reason: `资源 id 已存在：${item.id}` };
  }

  const next: ResourceCategory[] = [];
  let placed = false;
  for (const id of RESOURCE_CATEGORY_IDS) {
    const existing = dataset.find((group) => group.category === id);
    if (id === category) {
      next.push({
        category: id,
        categoryName: RESOURCE_CATEGORY_LABELS[id],
        items: [...(existing?.items ?? []), item],
      });
      placed = true;
      continue;
    }
    if (existing) next.push({ ...existing, items: [...existing.items] });
  }
  if (!placed) return { dataset, appended: false, reason: "分类未能落位" };
  return { dataset: next, appended: true };
}

/** 序列化回 `ui-resources.json` 的文本（作者据此贴回文件） */
export function serializeResourceDataset(dataset: ResourceCategory[]): string {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}
