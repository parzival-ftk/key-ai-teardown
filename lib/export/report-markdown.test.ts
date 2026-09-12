import { describe, it, expect } from "vitest";
import { reportToMarkdown } from "./report-markdown";
import { REPORT_SECTIONS } from "@/lib/report/sections";

describe("报告 → Markdown（Wave 5.5）", () => {
  it("含标题、全部 7 段章节与已生成内容", () => {
    const md = reportToMarkdown({
      name: "Notion",
      sections: [
        { agentId: "market", output: "这是市场分析" },
        { agentId: "prd", output: "这是 PRD" },
      ],
    });

    expect(md).toContain("# Notion · 拆解报告");
    for (const spec of REPORT_SECTIONS) {
      expect(md).toContain(spec.title);
    }
    expect(md).toContain("这是市场分析");
    expect(md).toContain("这是 PRD");
  });

  it("缺段章节显式标注负责 Agent（不静默留空）", () => {
    const md = reportToMarkdown({ name: "X", sections: [] });
    expect(md).toContain("待补充");
    expect(md).toContain("竞品分析师");
    expect(md).toContain("PRD 撰写官");
  });

  it("产品名缺省时用占位标题", () => {
    expect(reportToMarkdown({ sections: [] })).toContain("# 产品 · 拆解报告");
  });
});

describe("报告 → Markdown 证据标签（W2）", () => {
  it("带证据的段落导出中文标签前缀与来源", () => {
    const md = reportToMarkdown({
      name: "Notion",
      sections: [
        {
          agentId: "market",
          output: "这是市场分析",
          evidence: [
            {
              claim: "官网地址为 notion.so",
              label: "verified",
              source: "https://notion.so",
            },
            { claim: "已占据 40% 份额", label: "inferred" },
          ],
        },
      ],
    });

    expect(md).toContain("[已核实] 官网地址为 notion.so");
    expect(md).toContain("https://notion.so");
    expect(md).toContain("[推测] 已占据 40% 份额");
  });

  it("无证据的段落不产生空标签块", () => {
    const md = reportToMarkdown({
      name: "X",
      sections: [{ agentId: "market", output: "正文" }],
    });
    expect(md).not.toContain("[已核实]");
    expect(md).not.toContain("[推测]");
  });
});
