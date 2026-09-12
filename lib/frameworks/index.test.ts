import { describe, it, expect } from "vitest";
import { FRAMEWORKS, FRAMEWORK_LIST, renderBrief } from "./index";
import { jtbd } from "./jtbd";
import { businessCanvas } from "./business-canvas";
import { parseProductBrief } from "@/lib/types/brief";

const brief = parseProductBrief({
  name: "Notion",
  description: "协作文档工具",
});

describe("框架提示词库", () => {
  it("导出五个框架，id 齐全", () => {
    expect(FRAMEWORK_LIST).toHaveLength(5);
    expect(Object.keys(FRAMEWORKS).sort()).toEqual([
      "aarrr",
      "business-canvas",
      "five-forces",
      "jtbd",
      "swot",
    ]);
  });

  for (const fw of FRAMEWORK_LIST) {
    it(`${fw.id}：字段完整、无占位符残留、userPrompt 带产品信息`, () => {
      expect(fw.name.length).toBeGreaterThan(0);
      expect(fw.description.length).toBeGreaterThan(0);
      expect(fw.systemPrompt.length).toBeGreaterThan(20);
      expect(fw.systemPrompt).not.toMatch(/\{\{|TODO|FIXME|XXX/);

      const message = fw.userPrompt(brief);
      expect(message).toContain("Notion");
      expect(message).toContain("协作文档工具");
      expect(message).not.toMatch(/\{\{/);
    });
  }

  it("renderBrief 省略空字段，只留产品名", () => {
    expect(renderBrief(parseProductBrief({ name: "X" }))).toBe("产品名称：X");
  });

  it("JTBD 框架明确要求三层 job", () => {
    expect(jtbd.systemPrompt).toContain("functional");
    expect(jtbd.systemPrompt).toContain("emotional");
    expect(jtbd.systemPrompt).toContain("social");
  });

  it("商业模式画布含单位经济学（E6）", () => {
    expect(businessCanvas.systemPrompt).toContain("单位经济学");
  });
});
