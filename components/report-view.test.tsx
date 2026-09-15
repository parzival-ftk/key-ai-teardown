import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportView, type ReportData } from "./report-view";

/**
 * 报告页渲染边界（审查修复的回归护栏）。
 * 用 renderToStaticMarkup 做纯字符串断言：不必引入 DOM 测试库，ReportView 的
 * useEffect（会读 localStorage）在服务端渲染时不执行，initialData 直接进 state。
 */
function render(data: ReportData): string {
  return renderToStaticMarkup(<ReportView id="t" initialData={data} />);
}

describe("报告页证据渲染边界", () => {
  it("output 为空但有证据时，证据仍渲染（不被 output 分支连带过滤）", () => {
    const html = render({
      name: "X",
      sections: [
        {
          agentId: "market",
          name: "竞品分析师",
          status: "done",
          output: "",
          evidence: [{ claim: "某关键结论", label: "inferred" }],
        },
      ],
    });
    expect(html).toContain("某关键结论");
    expect(html).toContain("推测");
  });

  it("异常 label（如来自 localStorage 的损坏数据）不渲染成 [undefined]", () => {
    const html = render({
      name: "X",
      sections: [
        {
          agentId: "market",
          name: "竞品分析师",
          status: "done",
          output: "正文",
          evidence: [{ claim: "损坏项", label: "bogus" as never }],
        },
      ],
    });
    expect(html).not.toContain("undefined");
    expect(html).toContain("未知");
  });

  it("界面代码段：代码围栏被提取成代码面板，正文不残留围栏（W6）", () => {
    const html = render({
      name: "X",
      sections: [
        {
          agentId: "ui-code",
          name: "界面代码生成师",
          status: "done",
          output:
            '说明文字\n```html\n<div class="p-4">hi</div>\n```',
        },
      ],
    });
    expect(html).toContain("说明文字");
    expect(html).toContain("hi");
    expect(html).toContain("复制");
    // 代码被转义渲染（作为文本，而非注入 HTML）
    expect(html).toContain("&lt;div");
    // 正文里不再残留围栏标记
    expect(html).not.toContain("```");
  });

  it("界面代码段：渲染可交互预览 iframe（allow-same-origin + 脚本已剥，W7）", () => {
    const html = render({
      name: "X",
      sections: [
        {
          agentId: "ui-code",
          name: "界面代码生成师",
          status: "done",
          output: '说明\n```html\n<div class="p-4">hi</div>\n```',
        },
      ],
    });
    expect(html).toContain("<iframe");
    expect(html).toContain("预览（点击元素可选中并改 class）");
    expect(html).toContain('sandbox="allow-same-origin"');
    expect(html).toContain("p-4");
    // srcdoc 已剥脚本：骨架里不得出现 script
    expect(html).not.toContain("<script");
  });
});

describe("报告页 W15：Mermaid 图谱与质疑↔PRD 追溯", () => {
  const MERMAID_PRD = [
    "### 用户故事",
    "- 一键模板开始 [C1]",
    "### 风险",
    "- 灵活是双刃剑 [C1][C2]",
    "```mermaid",
    "flowchart TD",
    "  A[进入] --> B[选模板]",
    "```",
    "```mermaid",
    "stateDiagram-v2",
    "  [*] --> 空工作区",
    "```",
  ].join("\n");

  const data: ReportData = {
    name: "Notion",
    sections: [
      {
        agentId: "devils-advocate",
        name: "反方质疑官",
        status: "done",
        output: "C1. 壁垒可能被抹平。\nC2. 掌控感也可能是焦虑。\nC3. 社区供给缺数据。",
      },
      {
        agentId: "prd",
        name: "PRD 撰写官",
        status: "done",
        output: MERMAID_PRD,
        addressedCriticIds: ["C1", "C2"],
      },
    ],
  };

  it("PRD 段的 mermaid 围栏渲染成图谱查看器，且正文不残留围栏", () => {
    const html = render(data);
    expect((html.match(/data-mermaid-viewer/g) ?? []).length).toBe(2);
    // 报告页为每张图传入「段落名 · 图形类型」标题
    expect(html).toContain("· 流程图");
    expect(html).toContain("· 状态图");
    // 源码仍可在查看器里展开
    expect(html).toContain("查看 Mermaid 源码");
    // 服务端只渲染占位符（动态 mount 保护）
    expect(html).toContain("图谱渲染中…");
    expect(html).not.toContain("```mermaid");
  });

  it("mermaid 不会被当成普通代码块重复渲染", () => {
    const html = render(data);
    expect(html).not.toContain("复制当前 HTML");
    expect(html).not.toContain("&lt;div");
  });

  it("质疑段渲染成可点击条目，并给出回应覆盖率", () => {
    const html = render(data);
    expect(html).toContain('data-critic-item="C1"');
    expect(html).toContain('data-critic-jump="C2"');
    expect(html).toContain("质疑回应情况：已回应 2/3");
    expect(html).toContain("未回应 C3");
  });

  it("PRD 段的 [Cn] 标记渲染成可跳回的锚点", () => {
    const html = render(data);
    expect(html).toContain('id="prd-ref-c1"');
    expect(html).toContain('data-prd-ref="C2"');
  });
});
