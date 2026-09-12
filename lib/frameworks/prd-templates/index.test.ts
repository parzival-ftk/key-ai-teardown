import { describe, it, expect } from "vitest";
import {
  PRD_SECTIONS,
  renderPrdTemplate,
  LAUNCH_CHECKLIST,
  LAUNCH_CHECKLIST_CATEGORIES,
} from "./index";

describe("PRD 模板库（Wave 5.1/5.2）", () => {
  it("PRD 章节骨架非空且 key 唯一", () => {
    expect(PRD_SECTIONS.length).toBeGreaterThanOrEqual(5);
    const keys = PRD_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of PRD_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.guidance.length).toBeGreaterThan(0);
    }
  });

  it("章节包含用户故事、验收标准、成功指标、发布清单", () => {
    const titles = PRD_SECTIONS.map((s) => s.title).join("|");
    expect(titles).toContain("用户故事");
    expect(titles).toContain("验收标准");
    expect(titles).toContain("成功指标");
    expect(titles).toContain("发布就绪清单");
  });

  it("发布就绪清单项完整、id 唯一、有分类", () => {
    expect(LAUNCH_CHECKLIST.length).toBeGreaterThanOrEqual(6);
    const ids = LAUNCH_CHECKLIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of LAUNCH_CHECKLIST) {
      expect(item.category.length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
    }
    expect(LAUNCH_CHECKLIST_CATEGORIES.length).toBeGreaterThanOrEqual(4);
  });

  it("renderPrdTemplate 渲染出章节与清单，无未替换占位符", () => {
    const text = renderPrdTemplate();
    expect(text).toContain("用户故事与验收标准");
    expect(text).toContain("发布就绪清单");
    for (const item of LAUNCH_CHECKLIST) {
      expect(text).toContain(item.label);
    }
    expect(text).not.toMatch(/\{\{|TODO|FIXME/);
  });
});
