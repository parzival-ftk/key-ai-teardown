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
});
