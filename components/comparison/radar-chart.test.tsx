// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { RadarChart, axisAngle, polygonPoints, polarPoint, type RadarSeries } from "./RadarChart";
import { RADAR_DIMENSIONS, normalizeDimensionScores } from "@/lib/report/radar-dimensions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERIES: RadarSeries[] = [
  { id: "notion", label: "Notion", color: "#2563eb", scores: { ux: 90, monetization: 70, tech_barrier: 80, jtbd_fit: 85, growth: 75, risk: 60 } },
  { id: "figma", label: "Figma", color: "#16a34a", scores: { ux: 95, monetization: 80, tech_barrier: 70, jtbd_fit: 90, growth: 85, risk: 65 } },
  { id: "duolingo", label: "Duolingo", color: "#ea580c", scores: { ux: 80, monetization: 60, tech_barrier: 40, jtbd_fit: 70, growth: 95, risk: 55 } },
];

describe("几何计算（纯函数）", () => {
  it("第一根轴指向正上方，角度均分", () => {
    expect(axisAngle(0, 4)).toBeCloseTo(-Math.PI / 2);
    expect(axisAngle(1, 4)).toBeCloseTo(0);
  });

  it("polarPoint 半径 0 时落在圆心", () => {
    expect(polarPoint(100, 100, 0, 0, 6)).toEqual({ x: 100, y: 100 });
  });

  it("polygonPoints 顶点数 = 维度数，满值落在半径上", () => {
    const points = polygonPoints([100, 100, 100, 100, 100, 100], 160, 160, 100);
    expect(points.split(" ")).toHaveLength(6);
    const [x, y] = points.split(" ")[0].split(",").map(Number);
    expect(Math.hypot(x - 160, y - 160)).toBeCloseTo(100, 0);
  });

  it("数值越界被夹取（不外溢）", () => {
    const over = polygonPoints([150], 100, 100, 50);
    const under = polygonPoints([-20], 100, 100, 50);
    expect(over).toBe(polygonPoints([100], 100, 100, 50));
    expect(under).toBe(polygonPoints([0], 100, 100, 50));
  });

  it("normalizeDimensionScores：只认已知维度、夹取并四舍五入、丢弃非数字", () => {
    const out = normalizeDimensionScores({
      ux: 88.6,
      monetization: 120,
      tech_barrier: -5,
      unknown_dim: 50,
      jtbd_fit: "高" as unknown as number,
      growth: Number.NaN,
    });
    expect(out).toEqual({ ux: 89, monetization: 100, tech_barrier: 0 });
    expect(out.unknown_dim).toBeUndefined();
  });
});

describe("RadarChart（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(<RadarChart series={SERIES} />);

  it("绘制 6 条轴与网格，轴标签来自维度定义", () => {
    expect((html.match(/data-radar-dimension=/g) ?? []).length).toBe(RADAR_DIMENSIONS.length);
    for (const dim of RADAR_DIMENSIONS) expect(html).toContain(dim.label);
    expect((html.match(/data-radar-grid=/g) ?? []).length).toBe(4);
  });

  it("每个竞品一个半透明多边形 + 顶点圆点", () => {
    expect((html.match(/data-radar-polygon=/g) ?? []).length).toBe(3);
    expect(html).toContain('data-radar-series-count="3"');
    expect(html).toContain('data-radar-visible-count="3"');
    // 半透明重叠：fillOpacity 存在且不为 1
    expect(html).toMatch(/fill-opacity="0\.16"/);
    expect((html.match(/<circle/g) ?? []).length).toBe(3 * RADAR_DIMENSIONS.length);
  });

  it("图例含三个竞品，均可点击", () => {
    for (const s of SERIES) expect(html).toContain(`data-radar-legend-item="${s.id}"`);
    expect(html).toContain('aria-pressed="true"');
  });

  it("defaultHidden 的竞品不绘制多边形（图例仍保留）", () => {
    const hidden = renderToStaticMarkup(
      <RadarChart series={SERIES} defaultHidden={["figma"]} />,
    );
    expect((hidden.match(/data-radar-polygon=/g) ?? []).length).toBe(2);
    expect(hidden).toContain('data-radar-hidden="true"');
    expect(hidden).toContain('data-radar-legend-item="figma"');
  });

  it("缺少分数的维度按 0 处理（不崩、不隐藏轴）", () => {
    const partial = renderToStaticMarkup(
      <RadarChart series={[{ id: "x", label: "X", color: "#000", scores: { ux: 50 } }]} />,
    );
    expect(partial).toContain('data-radar-polygon="x"');
    expect((partial.match(/data-radar-dimension=/g) ?? []).length).toBe(RADAR_DIMENSIONS.length);
  });
});

describe("RadarChart 交互（jsdom）", () => {
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
  });

  const mount = (ui: React.ReactElement) => {
    act(() => root.render(ui));
  };

  it("点图例可切换该竞品显隐", () => {
    mount(<RadarChart series={SERIES} />);
    const item = () =>
      container.querySelector('[data-radar-legend-item="figma"]') as HTMLElement;

    expect(container.querySelectorAll("[data-radar-polygon]")).toHaveLength(3);
    act(() => item().click());
    expect(container.querySelectorAll("[data-radar-polygon]")).toHaveLength(2);
    expect(item().getAttribute("data-radar-hidden")).toBe("true");
    act(() => item().click());
    expect(container.querySelectorAll("[data-radar-polygon]")).toHaveLength(3);
  });

  it("hover 单个竞品 → 该多边形标记 active，其余不标记", () => {
    mount(<RadarChart series={SERIES} />);
    const group = (id: string) =>
      container.querySelector(`[data-radar-polygon="${id}"]`) as SVGGElement;

    act(() => {
      group("notion").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(group("notion").getAttribute("data-radar-active")).toBe("true");
    expect(group("figma").getAttribute("data-radar-active")).toBe("false");

    act(() => {
      group("notion").dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(group("notion").getAttribute("data-radar-active")).toBe("false");
  });

  it("hover 图例项也会高亮对应多边形", () => {
    mount(<RadarChart series={SERIES} />);
    const legend = container.querySelector(
      '[data-radar-legend-item="duolingo"]',
    ) as HTMLElement;
    act(() => {
      legend.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(
      container
        .querySelector('[data-radar-polygon="duolingo"]')
        ?.getAttribute("data-radar-active"),
    ).toBe("true");
  });
});
