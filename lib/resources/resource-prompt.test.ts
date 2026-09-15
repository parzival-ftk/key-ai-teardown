import { describe, it, expect } from "vitest";
import {
  RESOURCE_EXTRACTION_SYSTEM_PROMPT,
  buildResourceExtractionPrompt,
} from "./resource-prompt";
import {
  RESOURCE_CATEGORY_IDS,
  RESOURCE_CATEGORY_LABELS,
  parseResourceItem,
} from "./ui-resources";

describe("RESOURCE_EXTRACTION_SYSTEM_PROMPT", () => {
  it("覆盖全部 5 个分类的 id 与中文名（与数据源共用同一份常量）", () => {
    for (const id of RESOURCE_CATEGORY_IDS) {
      expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain(id);
      expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain(
        RESOURCE_CATEGORY_LABELS[id],
      );
    }
  });

  it("写明 4 标签规则、简介字数上限与 id 规范", () => {
    expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain("恰好 4 个");
    expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain("20 字");
    expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain("小写字母 + 数字 + 连字符");
  });

  it("给出与数据契约一致的 JSON 输出格式", () => {
    for (const key of ["id", "name", "url", "tags", "description"]) {
      expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain(`"${key}"`);
    }
    expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain("不要 Markdown 围栏");
  });

  it("提醒导航组件已存在，避免重复生成", () => {
    expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain("ResourceNav.tsx");
    expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain("不要重复生成组件代码");
  });

  it("外链安全约定写进提示词（与组件实际行为一致）", () => {
    expect(RESOURCE_EXTRACTION_SYSTEM_PROMPT).toContain('rel="noopener noreferrer"');
  });
});

describe("buildResourceExtractionPrompt", () => {
  it("拼入待处理来源与已收录 id", () => {
    const prompt = buildResourceExtractionPrompt({
      sources: "https://example.com/new-tool 一个很酷的工具",
      existingIds: ["coolors", "mobbin"],
    });
    expect(prompt.startsWith(RESOURCE_EXTRACTION_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("https://example.com/new-tool 一个很酷的工具");
    expect(prompt).toContain("coolors, mobbin");
  });

  it("没有已收录 id 时省略该小节", () => {
    const prompt = buildResourceExtractionPrompt({ sources: "https://a.dev/" });
    // 注意：系统提示词的 id 规则里也提到「已收录 id」，这里断言的是小节标题本身
    expect(prompt).not.toContain("【已收录 id（新条目不得与之重复）】");
    expect(prompt).toContain("【待处理的数据源 / 网址】");
  });

  it("来源为空时给出占位提示而不是空 prompt", () => {
    const prompt = buildResourceExtractionPrompt({ sources: "   " });
    expect(prompt).toContain("未提供待处理来源");
    expect(prompt).toContain(RESOURCE_EXTRACTION_SYSTEM_PROMPT);
  });
});

describe("提示词契约与校验器一致", () => {
  it("提示词规定的 JSON 形状能通过 parseResourceItem", () => {
    // 模拟模型按提示词产出的条目
    const produced = {
      id: "new-tool",
      name: "New Tool",
      url: "https://new-tool.dev/",
      tags: ["组件库", "Tailwind", "官网搭建", "开箱即用"],
      description: "复制即用的组件源码库。",
    };
    const result = parseResourceItem(produced);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.tags).toEqual(produced.tags);
    }
  });
});
