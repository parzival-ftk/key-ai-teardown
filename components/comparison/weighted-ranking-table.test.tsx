// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WeightedRankingTable,
  type WeightedRankingItem,
} from "./WeightedRankingTable";

/**
 * W20 · 动态综合排名表单测。
 * 数值口径由 `lib/compare/weighted-score` 保证（已单测）；这里验证**呈现与联动**：
 * 排名顺序、Δ / 名次变化 Badge 的符号与文案、降级提示。
 */

const DIMS = [
  { id: "a", label: "维度A" },
  { id: "b", label: "维度B" },
  { id: "c", label: "维度C" },
];

const ITEMS: WeightedRankingItem[] = [
  { id: "x", label: "X 产品", scores: { a: 100, b: 0, c: 0 } },
  { id: "y", label: "Y 产品", scores: { a: 0, b: 100, c: 100 } },
];

/** 静态渲染 → 挂到容器里便于 query */
function render(props: React.ComponentProps<typeof WeightedRankingTable>) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<WeightedRankingTable {...props} />);
  return container;
}

const cell = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-ranking-row="${id}"]`) as HTMLElement;

describe("WeightedRankingTable（等权基准）", () => {
  it("渲染全指标列 + 表头倍率", () => {
    const html = renderToStaticMarkup(<WeightedRankingTable items={ITEMS} dimensions={DIMS} />);
    expect(html).toContain("动态综合排名");
    expect(html).toContain("data-weighted-ranking");
    for (const dim of DIMS) expect(html).toContain(`data-ranking-head="${dim.id}"`);
    expect(html).toContain("×1"); // 等权倍率
  });

  it("等权时名次与基准一致、Δ 为 ±0", () => {
    const container = render({ items: ITEMS, dimensions: DIMS });
    expect(cell(container, "y").getAttribute("data-ranking-rank")).toBe("1");
    expect(cell(container, "x").getAttribute("data-ranking-rank")).toBe("2");
    expect(
      cell(container, "x").querySelector("[data-delta-badge]")?.getAttribute("data-delta-sign"),
    ).toBe("flat");
    expect(
      cell(container, "x").querySelector("[data-rank-delta-badge]")?.getAttribute("data-rank-delta-sign"),
    ).toBe("flat");
  });

  it("列出各维度原始分（全指标对比）", () => {
    const container = render({ items: ITEMS, dimensions: DIMS });
    expect(
      container.querySelector('[data-ranking-cell="x:a"]')?.textContent,
    ).toBe("100");
    expect(
      container.querySelector('[data-ranking-cell="y:b"]')?.textContent,
    ).toBe("100");
  });
});

describe("WeightedRankingTable（加权重排）", () => {
  const WEIGHTS = { a: 3, b: 1, c: 1 };

  it("权重改变后名次重排，并给出上升 / 下降 Badge", () => {
    const container = render({ items: ITEMS, dimensions: DIMS, weights: WEIGHTS });

    const x = cell(container, "x");
    const y = cell(container, "y");
    expect(x.getAttribute("data-ranking-rank")).toBe("1");
    expect(y.getAttribute("data-ranking-rank")).toBe("2");
    expect(
      x.querySelector("[data-rank-delta-badge]")?.getAttribute("data-rank-delta-sign"),
    ).toBe("up");
    expect(
      y.querySelector("[data-rank-delta-badge]")?.getAttribute("data-rank-delta-sign"),
    ).toBe("down");
  });

  it("加权综合分与 Δ 呈现在对应单元格", () => {
    const container = render({ items: ITEMS, dimensions: DIMS, weights: WEIGHTS });
    expect(
      container.querySelector('[data-ranking-weighted="x"]')?.textContent,
    ).toBe("60.0");
    expect(
      cell(container, "x").querySelector("[data-delta-badge]")?.textContent,
    ).toBe("+26.7");
    expect(
      cell(container, "y").querySelector("[data-delta-badge]")?.textContent,
    ).toBe("-26.7");
  });

  it("名次变化 Badge 带「基准名次 → 加权名次」提示", () => {
    const container = render({ items: ITEMS, dimensions: DIMS, weights: WEIGHTS });
    expect(
      cell(container, "x").querySelector("[data-rank-delta-badge]")?.getAttribute("title"),
    ).toBe("等权基准名次 2 → 加权名次 1");
  });

  it("表头倍率随权重显示", () => {
    const html = renderToStaticMarkup(
      <WeightedRankingTable items={ITEMS} dimensions={DIMS} weights={WEIGHTS} />,
    );
    expect(html).toContain("×3");
  });
});

describe("WeightedRankingTable（降级与空态）", () => {
  it("权重全 0 → 展示降级提示且不出现 NaN", () => {
    const container = render({
      items: ITEMS,
      dimensions: DIMS,
      weights: { a: 0, b: 0, c: 0 },
    });
    expect(container.querySelector("[data-ranking-fallback]")).not.toBeNull();
    expect(container.textContent).not.toContain("NaN");
    // 降级为等权后的实际口径
    expect(
      container.querySelector('[data-ranking-weighted="y"]')?.textContent,
    ).toBe("66.7");
  });

  it("空项目 → 给出空态提示，不抛错", () => {
    expect(() =>
      renderToStaticMarkup(<WeightedRankingTable items={[]} dimensions={DIMS} />),
    ).not.toThrow();
    const container = render({ items: [], dimensions: DIMS });
    expect(container.textContent).toContain("尚无可比较的维度打分");
  });
});
