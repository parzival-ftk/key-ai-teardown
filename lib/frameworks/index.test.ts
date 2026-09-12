import { describe, it, expect } from "vitest";
import { FRAMEWORKS, FRAMEWORK_LIST, renderBrief } from "./index";
import { jtbd } from "./jtbd";
import { businessCanvas } from "./business-canvas";
import { interviewer } from "./interviewer";
import { competitorProfiles } from "./competitor-profiles";
import { prd } from "./prd";
import { parseProductBrief } from "@/lib/types/brief";

const brief = parseProductBrief({
  name: "Notion",
  description: "协作文档工具",
});

describe("框架提示词库", () => {
  it("导出十二个框架，id 齐全", () => {
    expect(FRAMEWORK_LIST).toHaveLength(12);
    expect(Object.keys(FRAMEWORKS).sort()).toEqual([
      "aarrr",
      "business-canvas",
      "competitor-profiles",
      "devils-advocate",
      "five-forces",
      "interviewer",
      "jtbd",
      "prd",
      "swot",
      "synthesis",
      "ui-code",
      "visual-design",
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

  it("renderBrief 在共创模式下带「尚未落地」前缀", () => {
    const text = renderBrief(parseProductBrief({ name: "X", mode: "co-create" }));
    expect(text).toContain("尚未落地");
    expect(text).toContain("产品名称：X");
  });

  it("JTBD 框架明确要求三层 job", () => {
    expect(jtbd.systemPrompt).toContain("functional");
    expect(jtbd.systemPrompt).toContain("emotional");
    expect(jtbd.systemPrompt).toContain("social");
  });

  it("商业模式画布含单位经济学（E6）", () => {
    expect(businessCanvas.systemPrompt).toContain("单位经济学");
  });

  it("访谈官框架要求摩擦点与情绪潜台词（E4）", () => {
    expect(interviewer.systemPrompt).toContain("摩擦点");
    expect(interviewer.systemPrompt).toContain("情绪潜台词");
    expect(interviewer.systemPrompt).toContain("模拟");
  });

  it("竞品画像框架要求威胁等级（E1）", () => {
    expect(competitorProfiles.systemPrompt).toContain("威胁等级");
    expect(competitorProfiles.systemPrompt).toContain("高");
  });

  it("PRD 撰写官框架要求用户故事、验收标准与发布就绪清单（E5）", () => {
    expect(prd.systemPrompt).toContain("用户故事");
    expect(prd.systemPrompt).toContain("验收标准");
    expect(prd.systemPrompt).toContain("发布就绪清单");
  });

  it("视觉设计框架要求色板/字体层级/间距/组件/布局，且声明「分析非复制」（W5）", () => {
    const fw = FRAMEWORKS["visual-design"];
    expect(fw).toBeDefined();
    for (const kw of ["色板", "字体层级", "间距", "组件", "布局"]) {
      expect(fw.systemPrompt).toContain(kw);
    }
    // 心智模型：产出的是「参考起点」，必须自己设计，不照搬
    expect(fw.systemPrompt).toContain("自行设计");
  });

  it("界面代码框架要求 HTML + Tailwind，且声明「参考起点、自行设计」（W6）", () => {
    const fw = FRAMEWORKS["ui-code"];
    expect(fw).toBeDefined();
    expect(fw.systemPrompt).toContain("Tailwind");
    expect(fw.systemPrompt).toContain("参考起点");
    expect(fw.systemPrompt).toContain("自行设计");
  });
});
