import { describe, it, expect } from "vitest";
import {
  ALL_CATEGORIES,
  RESOURCE_CATEGORY_IDS,
  RESOURCE_CATEGORY_LABELS,
  RESOURCE_DESCRIPTION_MAX,
  RESOURCE_ID_PATTERN,
  RESOURCE_ID_RULE,
  appendResourceItem,
  collectTags,
  countChars,
  countResources,
  filterResources,
  findResourceById,
  loadResourceDataset,
  normalizeResourceDataset,
  parseResourceItem,
  resourceDatasetErrors,
  serializeResourceDataset,
  type ResourceItem,
} from "./ui-resources";

const dataset = loadResourceDataset();

describe("内置数据集：防漂移断言", () => {
  it("规范化零错误（新增条目格式不对会在这里红）", () => {
    expect(resourceDatasetErrors()).toEqual([]);
  });

  it("五个分类齐全且顺序与常量一致", () => {
    expect(dataset.map((group) => group.category)).toEqual([
      ...RESOURCE_CATEGORY_IDS,
    ]);
    for (const group of dataset) {
      expect(group.categoryName).toBe(RESOURCE_CATEGORY_LABELS[group.category]);
    }
  });

  it("共 22 条资源，每项字段完整且标签恰好 4 个非空", () => {
    expect(countResources(dataset)).toBe(22);
    for (const group of dataset) {
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.id).toMatch(/^[a-z0-9-]+$/);
        expect(item.name.length).toBeGreaterThan(0);
        expect(item.url).toMatch(/^https:\/\//);
        expect(item.description.length).toBeGreaterThan(0);
        expect(countChars(item.description)).toBeLessThanOrEqual(
          RESOURCE_DESCRIPTION_MAX,
        );
        expect(item.id).toMatch(RESOURCE_ID_PATTERN);
        expect(item.tags).toHaveLength(4);
        for (const tag of item.tags) expect(tag.trim()).toBe(tag);
      }
    }
  });

  it("资源 id 全局唯一", () => {
    const ids = dataset.flatMap((group) => group.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("normalizeResourceDataset：容错", () => {
  it("非数组 / 未知分类 / 非法项 / 重复 id 被丢弃并计入 errors", () => {
    expect(normalizeResourceDataset(null).errors).toContain("数据集顶层必须是数组");
    expect(normalizeResourceDataset({}).categories).toEqual([]);

    const dirty = normalizeResourceDataset([
      { category: "no-such", categoryName: "x", items: [] },
      {
        category: "colors-and-icons",
        categoryName: "色彩与图标",
        items: [
          { id: "a", name: "A", url: "https://a.dev/", tags: ["1", "2", "3"], description: "只有三个标签" },
          { id: "b", name: "B", url: "https://b.dev/", tags: ["1", "2", "3", "4"], description: "合法" },
          { id: "b", name: "B2", url: "https://b2.dev/", tags: ["1", "2", "3", "4"], description: "重复 id" },
        ],
      },
    ]);
    expect(dirty.errors).toContain("未知分类 id：no-such");
    expect(dirty.errors.some((e) => e.includes("id 重复"))).toBe(true);
    expect(dirty.categories[0].items.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("filterResources：分类筛选与关键字搜索", () => {
  it("按分类筛选", () => {
    const only = filterResources(dataset, { category: "colors-and-icons" });
    expect(only).toHaveLength(1);
    expect(only[0].category).toBe("colors-and-icons");
  });

  it("关键字命中名称 / 标签 / 简介，且大小写不敏感", () => {
    const byName = filterResources(dataset, { query: "mobbin" });
    expect(byName.flatMap((g) => g.items.map((i) => i.id))).toEqual(["mobbin"]);

    const byTag = filterResources(dataset, { query: "渐变" });
    expect(byTag.flatMap((g) => g.items.map((i) => i.id))).toContain("mesh-gradients");

    const byDesc = filterResources(dataset, { query: "图标" });
    expect(byDesc.flatMap((g) => g.items.map((i) => i.id)).length).toBeGreaterThan(0);

    expect(filterResources(dataset, { query: "TAILWIND" }).length).toBeGreaterThan(0);
  });

  it("分类 + 关键字叠加；无命中返回空数组", () => {
    expect(filterResources(dataset, { category: "colors-and-icons", query: "coolors" })).toHaveLength(1);
    expect(
      filterResources(dataset, { category: "colors-and-icons", query: "mobbin" }),
    ).toEqual([]);
    expect(filterResources(dataset, { query: "绝不存在的关键字" })).toEqual([]);
    expect(filterResources(dataset, { category: ALL_CATEGORIES })).toHaveLength(5);
  });

  it("不改动入参（纯函数）", () => {
    const before = dataset.map((g) => g.items.length);
    filterResources(dataset, { query: "ui" });
    expect(dataset.map((g) => g.items.length)).toEqual(before);
  });
});

describe("collectTags / findResourceById", () => {
  it("标签去重且保序", () => {
    const tags = collectTags(dataset);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain("Tailwind");
  });

  it("按 id 查找", () => {
    expect(findResourceById(dataset, "shadcn-ui")?.name).toBe("Shadcn UI");
    expect(findResourceById(dataset, "nope")).toBeNull();
  });
});

describe("扩充闭环：parseResourceItem / appendResourceItem / serialize", () => {
  const valid = {
    id: "new-tool",
    name: "New Tool",
    url: "https://new.dev/",
    tags: ["A", "B", "C", "D"],
    description: "一句话简介。",
  };

  it("校验合法条目", () => {
    const result = parseResourceItem(valid);
    expect(result.ok).toBe(true);
  });

  it("强制 id 契约（大写 / 下划线 / 空格 / 空串都被拒）", () => {
    for (const bad of ["Bad-Id", "bad_id", "bad id", "-bad", "bad-"]) {
      const result = parseResourceItem({ ...valid, id: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.join(" ")).toContain("id 不符合契约");
      }
    }
    // 契约的人话版本与正则指向同一规则
    expect(RESOURCE_ID_PATTERN.test(valid.id)).toBe(true);
    expect(RESOURCE_ID_RULE).toContain("连字符");
  });

  it("简介严格按 RESOURCE_DESCRIPTION_MAX 判定（边界值 20 通过、21 拒绝）", () => {
    const twenty = "一".repeat(RESOURCE_DESCRIPTION_MAX);
    expect(parseResourceItem({ ...valid, description: twenty }).ok).toBe(true);

    const twentyOne = "一".repeat(RESOURCE_DESCRIPTION_MAX + 1);
    const over = parseResourceItem({ ...valid, description: twentyOne });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors.join(" ")).toContain(`≤${RESOURCE_DESCRIPTION_MAX}`);
    }
  });

  it("拒绝标签数量不对 / 非 http url", () => {
    expect(parseResourceItem({ ...valid, tags: ["A", "B", "C"] }).ok).toBe(false);
    expect(parseResourceItem({ ...valid, url: "ftp://x" }).ok).toBe(false);
  });

  it("追加到指定分类（不可变，原数据集不变）", () => {
    const before = countResources(dataset);
    const result = appendResourceItem(
      dataset,
      "colors-and-icons",
      valid as ResourceItem,
    );
    expect(result.appended).toBe(true);
    expect(countResources(result.dataset)).toBe(before + 1);
    expect(countResources(dataset)).toBe(before);
    expect(findResourceById(result.dataset, "new-tool")).not.toBeNull();
  });

  it("id 重复 / 分类非法 → 不追加并给出原因", () => {
    const dup = appendResourceItem(dataset, "colors-and-icons", {
      ...valid,
      id: "coolors",
    } as ResourceItem);
    expect(dup.appended).toBe(false);
    expect(dup.reason).toContain("已存在");

    const bad = appendResourceItem(
      dataset,
      "no-such" as never,
      valid as ResourceItem,
    );
    expect(bad.appended).toBe(false);
  });

  it("序列化可被 JSON.parse 还原，且以换行结尾", () => {
    const text = serializeResourceDataset(dataset);
    expect(text.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(dataset.length);
    expect(parsed[0].items.length).toBe(dataset[0].items.length);
  });
});
