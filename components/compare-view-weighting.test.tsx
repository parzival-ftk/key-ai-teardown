// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CompareView, type CompareInitialData } from "./compare-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * W20 · 对比页「权重 → 雷达图 → 排名表」联动集成测试。
 *
 * 数据刻意造成「等权时 Y 领先、把 UI/UX 权重拉到 3x 后 X 反超」，
 * 从而在真实组件树上验证：滑杆 → 加权综合分 → 名次重排 → Badge 与雷达轴长同步。
 */

/** 雷达系列 id 由 compare-view 生成为 `p<index>`（与产品名无关） */
const X = "p0"; // X 产品：只有 UI/UX 强
const Y = "p1"; // Y 产品：其余五维均衡

const DATA: CompareInitialData = {
  products: ["X 产品", "Y 产品"],
  comparison: { output: "对比结论正文", evidence: [] },
  dimensionScores: [
    { ux: 90, monetization: 0, tech_barrier: 0 },
    { ux: 0, monetization: 30, tech_barrier: 30, jtbd_fit: 30, growth: 30, risk: 30 },
  ],
};

describe("对比页：维度权重联动（W20）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sessionStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const mount = () =>
    act(() => {
      root.render(<CompareView id="t" initialData={DATA} />);
    });

  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;

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

  const rankOf = (id: string) =>
    container
      .querySelector(`[data-ranking-row="${id}"]`)
      ?.getAttribute("data-ranking-rank");
  const weightedOf = (id: string) =>
    container.querySelector(`[data-ranking-weighted="${id}"]`)?.textContent;
  /** 名次徽章的属性名是 `data-rank-delta-badge`（不是 `data-rank-badge`） */
  const badgeOf = (id: string, kind: "delta" | "rank") => {
    const attr = kind === "delta" ? "delta" : "rank-delta";
    return container
      .querySelector(`[data-ranking-row="${id}"] [data-${attr}-badge]`)
      ?.getAttribute(`data-${attr}-sign`);
  };

  it("渲染权重面板、雷达图与排名表三件套，并列出两个竞品", () => {
    mount();
    expect(container.querySelector("[data-weight-controls]")).not.toBeNull();
    expect(container.querySelector("[data-radar]")).not.toBeNull();
    expect(container.querySelector("[data-weighted-ranking]")).not.toBeNull();
    expect(container.querySelector(`[data-ranking-row="${X}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-ranking-row="${Y}"]`)).not.toBeNull();
  });

  it("初始等权：Y 领先，Δ 与名次变化均为 0", () => {
    mount();
    expect(rankOf(Y)).toBe("1");
    expect(rankOf(X)).toBe("2");
    expect(weightedOf(X)).toBe("15.0"); // (90+0+0+0+0+0)/6
    expect(weightedOf(Y)).toBe("25.0"); // (0+30×5)/6
    expect(badgeOf(X, "delta")).toBe("flat");
    expect(badgeOf(X, "rank")).toBe("flat");
  });

  it("把 UI/UX 权重拉到 3x → 综合分重算、名次互换、Badge 翻转、雷达轴长同步", () => {
    mount();

    act(() => $("[data-weight-panel-toggle]").click());
    act(() => setSlider("ux", 3));

    // 1) 综合分按 Σ(分×权)/Σ(权) 重算（Σ权 = 3 + 5×1 = 8）
    expect(weightedOf(X)).toBe("33.8"); // 90×3 / 8
    expect(weightedOf(Y)).toBe("18.8"); // 30×5 / 8

    // 2) 名次互换
    expect(rankOf(X)).toBe("1");
    expect(rankOf(Y)).toBe("2");

    // 3) Badge 翻转
    expect(badgeOf(X, "rank")).toBe("up");
    expect(badgeOf(Y, "rank")).toBe("down");
    expect(
      container.querySelector(`[data-ranking-row="${X}"] [data-delta-badge]`)
        ?.textContent,
    ).toBe("+18.8");

    // 4) 雷达图：ux 轴满半径，其余轴缩到 1/3
    expect(
      container
        .querySelector('[data-radar-dimension="ux"]')
        ?.getAttribute("data-radar-axis-scale"),
    ).toBe("1");
    expect(
      container
        .querySelector('[data-radar-dimension="monetization"]')
        ?.getAttribute("data-radar-axis-scale"),
    ).toBe("0.33");
    expect(container.querySelector("[data-radar-weight-note]")).not.toBeNull();
  });

  it("「重置为默认」把名次与雷达图一起还原", () => {
    mount();
    act(() => $("[data-weight-panel-toggle]").click());
    act(() => setSlider("ux", 3));
    expect(rankOf(X)).toBe("1");

    act(() => $('[data-weight-action="reset"]').click());
    expect(rankOf(Y)).toBe("1");
    expect(weightedOf(X)).toBe("15.0");
    expect(container.querySelector("[data-radar-weight-note]")).toBeNull();
  });

  it("权重全为 0 → 表内给出降级提示且不出现 NaN", () => {
    mount();
    act(() => $("[data-weight-panel-toggle]").click());
    for (const dim of ["ux", "monetization", "tech_barrier", "jtbd_fit", "growth", "risk"]) {
      act(() => setSlider(dim, 0));
    }
    expect(container.querySelector("[data-ranking-fallback]")).not.toBeNull();
    expect(container.textContent).not.toContain("NaN");
  });

  it("只有 1 个产品拿到维度分时不渲染雷达图与排名表（避免单点对比）", () => {
    act(() => {
      root.render(
        <CompareView
          id="t"
          initialData={{
            products: ["X 产品"],
            comparison: { output: "", evidence: [] },
            dimensionScores: [{ ux: 90, monetization: 10, tech_barrier: 10 }],
          }}
        />,
      );
    });
    expect(container.querySelector("[data-radar]")).toBeNull();
    expect(container.querySelector("[data-weighted-ranking]")).toBeNull();
  });
});
