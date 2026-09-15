// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryDiffView, toSplitRows } from "./HistoryDiffView";
import { ReportDiffModal } from "./ReportDiffModal";
import { diffReports, type DiffReport, type TextDiffLine } from "@/lib/compare/report-diff";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 用真实引擎产出的 diff 做夹具，避免手工构造与实现口径脱节 */
const BASE: DiffReport = {
  name: "基准报告",
  sections: [
    { agentId: "market", name: "竞品分析师", output: "第一行\n第二行\n第三行", dimensionScores: { ux: 80, growth: 60 } },
    { agentId: "prd", name: "PRD 撰写官", output: "PRD 正文\n```mermaid\nflowchart TD\n  A --> B\n```" },
    { agentId: "synthesis", name: "PM 综合官", output: "只存在于基准" },
  ],
};
const COMPARE: DiffReport = {
  name: "对比报告",
  sections: [
    { agentId: "market", name: "竞品分析师", output: "第一行\n改过了\n第三行", dimensionScores: { ux: 90, growth: 50 } },
    { agentId: "prd", name: "PRD 撰写官", output: "PRD 正文\n```mermaid\nflowchart TD\n  A --> C\n```" },
    { agentId: "newcomer", name: "新段", output: "全新段落" },
  ],
};
const DIFF = diffReports(BASE, COMPARE);

const line = (
  type: TextDiffLine["type"],
  text: string,
  baseLine: number | null,
  compareLine: number | null,
): TextDiffLine => ({ type, text, baseLine, compareLine });

describe("toSplitRows（双栏对齐）", () => {
  it("未变行同时出现在左右两侧", () => {
    expect(toSplitRows([line("unchanged", "a", 1, 1)])).toEqual([
      {
        left: { text: "a", type: "unchanged", line: 1 },
        right: { text: "a", type: "unchanged", line: 1 },
      },
    ]);
  });

  it("「改一行」的 removed+added 配对到同一行", () => {
    const rows = toSplitRows([
      line("removed", "旧", 2, null),
      line("added", "新", null, 2),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toEqual({ text: "旧", type: "removed", line: 2 });
    expect(rows[0].right).toEqual({ text: "新", type: "added", line: 2 });
  });

  it("两侧数量不等时用 null 补位", () => {
    const rows = toSplitRows([
      line("removed", "旧1", 2, null),
      line("removed", "旧2", 3, null),
      line("added", "新1", null, 2),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].left).toEqual({ text: "旧2", type: "removed", line: 3 });
    expect(rows[1].right).toBeNull();
  });

  it("变更块被未变行正确切分", () => {
    const rows = toSplitRows([
      line("unchanged", "头", 1, 1),
      line("added", "新", null, 2),
      line("unchanged", "尾", 2, 3),
    ]);
    expect(rows.map((r) => [r.left?.type ?? null, r.right?.type ?? null])).toEqual([
      ["unchanged", "unchanged"],
      [null, "added"],
      ["unchanged", "unchanged"],
    ]);
  });
});

describe("HistoryDiffView（unified 单栏）", () => {
  const html = renderToStaticMarkup(<HistoryDiffView diff={DIFF} mode="unified" />);

  it("每个段落带状态徽章与增删行数", () => {
    expect(html).toContain('data-diff-section="market"');
    expect(html).toContain('data-diff-section-status="modified"');
    expect(html).toContain('data-diff-section-status="removed"');
    expect(html).toContain('data-diff-section-status="added"');
    expect(html).toContain("data-diff-stats-added");
    expect(html).toContain("data-diff-stats-removed");
  });

  it("变更行按类型着色：新增浅绿、删除浅红 + 删除线", () => {
    expect(html).toContain('data-diff-type="added"');
    expect(html).toContain('data-diff-type="removed"');
    expect(html).toMatch(/bg-green-50/);
    expect(html).toMatch(/bg-red-50[^"]*line-through/);
  });

  it("维度分变化与 Mermaid 图谱变动各自呈现", () => {
    expect(html).toContain('data-diff-dimension="ux"');
    expect(html).toContain('data-diff-dimension-delta="10"');
    expect(html).toContain('data-diff-dimension-delta="-10"');
    expect(html).toContain('data-diff-mermaid="0"');
    expect(html).toContain('data-diff-mermaid-status="modified"');
  });

  it("showUnchanged=false 时不再渲染未变行", () => {
    const onlyChanges = renderToStaticMarkup(
      <HistoryDiffView diff={DIFF} mode="unified" showUnchanged={false} />,
    );
    expect(onlyChanges).not.toContain('data-diff-type="unchanged"');
    expect(onlyChanges).toContain('data-diff-type="added"');
  });
});

describe("HistoryDiffView（split 双栏）", () => {
  const html = renderToStaticMarkup(<HistoryDiffView diff={DIFF} mode="split" />);

  it("渲染 base / compare 两列单元格", () => {
    expect(html).toContain("data-diff-split");
    expect(html).toContain('data-diff-cell="base"');
    expect(html).toContain('data-diff-cell="compare"');
  });

  it("被改的那一行左右对照（左 removed、右 added）", () => {
    const container = document.createElement("div");
    container.innerHTML = html;
    const row = [...container.querySelectorAll("[data-diff-split-row]")].find((r) =>
      r.textContent?.includes("改过了"),
    );
    expect(row?.querySelector('[data-diff-cell="base"]')?.getAttribute("data-diff-cell-type")).toBe(
      "removed",
    );
    expect(
      row?.querySelector('[data-diff-cell="compare"]')?.getAttribute("data-diff-cell-type"),
    ).toBe("added");
  });

  it("空 diff 给出提示", () => {
    const empty = renderToStaticMarkup(
      <HistoryDiffView diff={diffReports({}, {})} mode="split" />,
    );
    expect(empty).toContain("两份报告都没有可比较的段落");
  });
});

describe("ReportDiffModal（jsdom 交互）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const mount = (ui: React.ReactElement) =>
    act(() => {
      root.render(ui);
    });
  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
  const mountModal = () =>
    mount(
      <ReportDiffModal
        base={{ id: "a", name: "基准报告", report: BASE }}
        compare={{ id: "b", name: "对比报告", report: COMPARE }}
        onClose={() => {}}
      />,
    );

  it("渲染标题、两侧名称与变更摘要", () => {
    mountModal();
    expect(container.querySelector("[data-report-diff-modal]")).not.toBeNull();
    expect(container.querySelector("[data-diff-pair]")?.textContent).toContain("基准报告");
    expect(container.querySelector("[data-diff-pair]")?.textContent).toContain("对比报告");
    expect(container.querySelector("[data-diff-summary]")?.textContent).toContain("新增 1");
    expect(container.querySelector("[data-diff-summary]")?.textContent).toContain("删除 1");
    expect(container.querySelector("[data-diff-summary]")?.textContent).toContain("修改 2");
  });

  it("默认双栏，可切换到单栏", () => {
    mountModal();
    expect($("[data-diff-view]").getAttribute("data-diff-mode")).toBe("split");
    expect(container.querySelector("[data-diff-split]")).not.toBeNull();

    act(() => $('[data-diff-mode="unified"]').click());
    expect($("[data-diff-view]").getAttribute("data-diff-mode")).toBe("unified");
    expect(container.querySelector("[data-diff-unified]")).not.toBeNull();
    expect($('[data-diff-mode="unified"]').getAttribute("aria-selected")).toBe("true");
  });

  it("取消「显示未变更」后只剩变更行", () => {
    mountModal();
    // 未变行只在单栏模式渲染为 data-diff-line（双栏用 data-diff-cell-type）
    act(() => $('[data-diff-mode="unified"]').click());
    expect(container.querySelector('[data-diff-type="unchanged"]')).not.toBeNull();
    act(() => {
      const box = $("[data-diff-show-unchanged]") as HTMLInputElement;
      box.click();
    });
    expect(container.querySelector('[data-diff-type="unchanged"]')).toBeNull();
    expect(container.querySelector('[data-diff-type="added"]')).not.toBeNull();
  });

  it("点击关闭按钮 / 遮罩触发 onClose，面板内点击不触发", () => {
    const onClose = vi.fn();
    mount(
      <ReportDiffModal
        base={{ id: "a", name: "A", report: BASE }}
        compare={{ id: "b", name: "B", report: COMPARE }}
        onClose={onClose}
      />,
    );
    act(() => $("[data-diff-view]").click());
    expect(onClose).not.toHaveBeenCalled();
    act(() => $('[data-diff-action="close"]').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => $("[data-report-diff-modal]").click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("两份完全一致时给出「完全一致」提示", () => {
    mount(
      <ReportDiffModal
        base={{ id: "a", name: "A", report: BASE }}
        compare={{ id: "b", name: "B", report: BASE }}
        onClose={() => {}}
      />,
    );
    expect(container.querySelector("[data-diff-summary]")?.textContent).toContain(
      "完全一致",
    );
  });
});
