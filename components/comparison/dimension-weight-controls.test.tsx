// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DimensionWeightControls,
  formatWeight,
} from "./DimensionWeightControls";
import { RADAR_DIMENSIONS } from "@/lib/report/radar-dimensions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("formatWeight", () => {
  it("整数不带小数，非整数保留一位", () => {
    expect(formatWeight(1)).toBe("1x");
    expect(formatWeight(1.5)).toBe("1.5x");
    expect(formatWeight(0)).toBe("0x");
    expect(formatWeight(2.4)).toBe("2.4x");
  });
});

describe("DimensionWeightControls（服务端静态渲染）", () => {
  it("默认收起：只有标题行，不渲染滑杆面板", () => {
    const html = renderToStaticMarkup(
      <DimensionWeightControls weights={{}} onChange={() => {}} />,
    );
    expect(html).toContain("data-weight-controls");
    expect(html).toContain("维度权重配置");
    expect(html).toContain('data-weight-panel-toggle');
    // 注意：不能断言不含 "data-weight-panel" —— 那是 "data-weight-panel-toggle" 的子串
    expect(html).not.toContain('data-weight-panel="true"');
    expect(html).toContain("默认等权");
  });

  it("defaultExpanded 时渲染 6 个维度滑杆，初始均为 1x", () => {
    const html = renderToStaticMarkup(
      <DimensionWeightControls weights={{}} onChange={() => {}} defaultExpanded />,
    );
    for (const dim of RADAR_DIMENSIONS) {
      expect(html).toContain(`data-weight-slider="${dim.id}"`);
      expect(html).toContain(`data-weight-value="${dim.id}"`);
    }
    expect((html.match(/1x</g) ?? []).length).toBe(RADAR_DIMENSIONS.length);
  });

  it("已调整时摘要列出项数与倍率", () => {
    const html = renderToStaticMarkup(
      <DimensionWeightControls weights={{ ux: 2, risk: 0.5 }} onChange={() => {}} />,
    );
    expect(html).toContain("已调整 2 项");
    expect(html).toContain("2x");
    expect(html).toContain("0.5x");
  });

  it("未做调整时「重置为默认」禁用", () => {
    const html = renderToStaticMarkup(
      <DimensionWeightControls weights={{}} onChange={() => {}} />,
    );
    expect(html).toMatch(/data-weight-action="reset"[^>]*disabled/);
  });
});

describe("DimensionWeightControls（jsdom 交互）", () => {
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

  /** React 受控输入：走原生 setter 再派发 input，否则 onChange 不触发 */
  const setSlider = (dimId: string, value: number) => {
    const el = container.querySelector(
      `[data-weight-slider="${dimId}"]`,
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("展开 / 收起切换面板", () => {
    mount(<DimensionWeightControls weights={{}} onChange={() => {}} />);
    expect(container.querySelector("[data-weight-panel]")).toBeNull();
    act(() => $("[data-weight-panel-toggle]").click());
    expect(container.querySelector("[data-weight-panel]")).not.toBeNull();
    expect($("[data-weight-panel-toggle]").getAttribute("aria-expanded")).toBe("true");
    act(() => $("[data-weight-panel-toggle]").click());
    expect(container.querySelector("[data-weight-panel]")).toBeNull();
  });

  it("拖动滑杆 → onChange 收到合并后的权重", () => {
    const onChange = vi.fn();
    mount(
      <DimensionWeightControls
        weights={{ risk: 0.5 }}
        onChange={onChange}
        defaultExpanded
      />,
    );
    act(() => setSlider("ux", 2));
    expect(onChange).toHaveBeenCalledWith({ risk: 0.5, ux: 2 });
  });

  it("拖到 0 也如实上报（表示该维度不参与比较）", () => {
    const onChange = vi.fn();
    mount(
      <DimensionWeightControls weights={{}} onChange={onChange} defaultExpanded />,
    );
    act(() => setSlider("growth", 0));
    expect(onChange).toHaveBeenCalledWith({ growth: 0 });
  });

  it("倍率文案随权重实时变化", () => {
    mount(
      <DimensionWeightControls weights={{ ux: 1.5 }} onChange={() => {}} defaultExpanded />,
    );
    expect($('[data-weight-value="ux"]').textContent).toBe("1.5x");
    expect($('[data-weight-value="risk"]').textContent).toBe("1x");
  });

  it("点击「重置为默认」→ onChange 收到空权重（即全部回默认）", () => {
    const onChange = vi.fn();
    mount(
      <DimensionWeightControls weights={{ ux: 2 }} onChange={onChange} />,
    );
    act(() => $('[data-weight-action="reset"]').click());
    expect(onChange).toHaveBeenCalledWith({});
  });
});
