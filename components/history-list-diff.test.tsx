// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HistoryList } from "./history-list";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * W21 · 历史列表「对比模式 → 多选 → 浮出操作栏 → Diff 弹窗」集成测试。
 * 直接用 seed 好的 localStorage 渲染真实组件（store 从 localStorage 读，不 mock）。
 */

const A = { id: "a", name: "报告A", createdAt: 1000 };
const B = { id: "b", name: "报告B", createdAt: 2000 };
const C = { id: "c", name: "报告C", createdAt: 3000 };

const REPORT_A = { name: "报告A", sections: [{ agentId: "market", name: "竞品分析师", output: "旧内容" }] };
const REPORT_B = { name: "报告B", sections: [{ agentId: "market", name: "竞品分析师", output: "旧内容" }] };
const REPORT_C = { name: "报告C", sections: [{ agentId: "market", name: "竞品分析师", output: "新内容" }] };

function seed() {
  localStorage.setItem("key:history", JSON.stringify([A, B, C]));
  localStorage.setItem("key:report:a", JSON.stringify(REPORT_A));
  localStorage.setItem("key:report:b", JSON.stringify(REPORT_B));
  localStorage.setItem("key:report:c", JSON.stringify(REPORT_C));
}

describe("HistoryList：对比模式与 Diff（W21）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    seed();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const mount = () =>
    act(() => {
      root.render(<HistoryList />);
    });
  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
  const select = (id: string) =>
    (container.querySelector(`[data-history-select="${id}"]`) as HTMLInputElement);

  it("默认不显示勾选框与操作栏", () => {
    mount();
    expect(container.querySelector("[data-history-compare-toggle]")).not.toBeNull();
    expect(container.querySelector("[data-history-select]")).toBeNull();
    expect(container.querySelector("[data-history-diff-bar]")).toBeNull();
  });

  it("进入对比模式后每行出现勾选框", () => {
    mount();
    act(() => $("[data-history-compare-toggle]").click());
    expect(container.querySelectorAll("[data-history-select]")).toHaveLength(3);
    expect($("[data-history-selected-count]").textContent).toContain("已选 0/2");
  });

  it("勾选 1 份不出操作栏；勾满 2 份浮出操作栏", () => {
    mount();
    act(() => $("[data-history-compare-toggle]").click());

    act(() => select("a").click());
    expect($("[data-history-selected-count]").textContent).toContain("已选 1/2");
    expect(container.querySelector("[data-history-diff-bar]")).toBeNull();

    act(() => select("c").click());
    expect(container.querySelector("[data-history-diff-bar]")).not.toBeNull();
    // 以较早的一份为基准
    expect($("[data-history-diff-bar]").textContent).toContain("基准：报告A");
    expect($("[data-history-diff-bar]").textContent).toContain("对比：报告C");
  });

  it("勾满 2 份后第 3 个勾选框被禁用（不会悄悄挤掉已选）", () => {
    mount();
    act(() => $("[data-history-compare-toggle]").click());
    act(() => select("a").click());
    act(() => select("c").click());

    expect(select("b").disabled).toBe(true);
    expect(select("a").disabled).toBe(false); // 已选的仍可取消
    act(() => select("b").click());
    expect($("[data-history-selected-count]").textContent).toContain("已选 2/2");
  });

  it("取消勾选后操作栏收起", () => {
    mount();
    act(() => $("[data-history-compare-toggle]").click());
    act(() => select("a").click());
    act(() => select("c").click());
    expect(container.querySelector("[data-history-diff-bar]")).not.toBeNull();

    act(() => select("c").click());
    expect(container.querySelector("[data-history-diff-bar]")).toBeNull();
  });

  it("点「对比这 2 份报告」→ 弹出 Diff 弹窗并展示真实差异", () => {
    mount();
    act(() => $("[data-history-compare-toggle]").click());
    act(() => select("a").click());
    act(() => select("c").click());
    act(() => $("[data-history-diff-action]").click());

    expect(container.querySelector("[data-report-diff-modal]")).not.toBeNull();
    expect($("[data-diff-summary]").textContent).toContain("修改 1");
    expect(
      container.querySelector('[data-diff-section="market"]')?.getAttribute(
        "data-diff-section-status",
      ),
    ).toBe("modified");
    // 旧内容被删、新内容被增
    const cells = [...container.querySelectorAll("[data-diff-cell-type]")].map((c) =>
      c.getAttribute("data-diff-cell-type"),
    );
    expect(cells).toContain("removed");
    expect(cells).toContain("added");
  });

  it("退出对比模式会清空已选并收起操作栏", () => {
    mount();
    act(() => $("[data-history-compare-toggle]").click());
    act(() => select("a").click());
    act(() => select("c").click());
    act(() => $("[data-history-compare-toggle]").click());

    expect(container.querySelectorAll("[data-history-select]")).toHaveLength(0);
    expect(container.querySelector("[data-history-diff-bar]")).toBeNull();
  });

  it("关闭弹窗后回到列表（对比模式与已选保留）", () => {
    mount();
    act(() => $("[data-history-compare-toggle]").click());
    act(() => select("a").click());
    act(() => select("c").click());
    act(() => $("[data-history-diff-action]").click());
    act(() => $('[data-diff-action="close"]').click());

    expect(container.querySelector("[data-report-diff-modal]")).toBeNull();
    expect($("[data-history-selected-count]").textContent).toContain("已选 2/2");
  });
});
