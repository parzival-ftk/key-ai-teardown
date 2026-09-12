import { describe, it, expect } from "vitest";
import { parseProductBrief, safeParseProductBrief } from "./brief";

describe("ProductBriefSchema", () => {
  it("解析最小输入并填充默认值", () => {
    const brief = parseProductBrief({ name: "Notion" });
    expect(brief.name).toBe("Notion");
    expect(brief.description).toBe("");
    expect(brief.mode).toBe("teardown");
    expect(brief.source).toBe("text");
    expect(brief.rawText).toBe("");
  });

  it("空名称被拒绝", () => {
    expect(safeParseProductBrief({ name: "" }).success).toBe(false);
  });

  it("缺少 name 被拒绝", () => {
    expect(safeParseProductBrief({ description: "只有描述" }).success).toBe(
      false,
    );
  });

  it("非法 mode 被拒绝", () => {
    expect(
      safeParseProductBrief({ name: "A", mode: "unknown" }).success,
    ).toBe(false);
  });

  it("保留共创模式与来源类型", () => {
    const brief = parseProductBrief({
      name: "一个想法",
      mode: "co-create",
      source: "url",
      sourceUrl: "https://example.com",
    });
    expect(brief.mode).toBe("co-create");
    expect(brief.source).toBe("url");
    expect(brief.sourceUrl).toBe("https://example.com");
  });
});
