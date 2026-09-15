import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIEWPORT,
  GRID_SIZE,
  MAX_SCALE,
  MIN_SCALE,
  canvasToScreen,
  centerOf,
  clampScale,
  fitToRect,
  formatZoom,
  panBy,
  screenToCanvas,
  visibleRect,
  zoomAt,
  zoomTo,
  type Viewport,
} from "./viewport";

describe("坐标变换", () => {
  it("screen ↔ canvas 互为逆变换", () => {
    const viewport: Viewport = { x: 120, y: -40, scale: 1.5 };
    const screen = canvasToScreen(viewport, { x: 200, y: 80 });
    expect(screen).toEqual({ x: 120 + 300, y: -40 + 120 });

    const back = screenToCanvas(viewport, screen);
    expect(back.x).toBeCloseTo(200, 6);
    expect(back.y).toBeCloseTo(80, 6);
  });

  it("默认视口下画布点等于屏幕点", () => {
    expect(canvasToScreen(DEFAULT_VIEWPORT, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it("scale 为 0 时 screenToCanvas 不产生 Infinity", () => {
    const point = screenToCanvas({ x: 0, y: 0, scale: 0 }, { x: 5, y: 5 });
    expect(Number.isFinite(point.x)).toBe(true);
  });
});

describe("clampScale", () => {
  it("夹取到 [MIN, MAX]", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it("非法值回落为 1", () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("zoomAt：锚点不变量", () => {
  it("缩放前后，光标下的画布点原地不动", () => {
    const viewport: Viewport = { x: 30, y: 70, scale: 1 };
    const anchor = { x: 400, y: 260 };
    const before = screenToCanvas(viewport, anchor);

    const zoomed = zoomAt(viewport, 1.25, anchor);
    const after = screenToCanvas(zoomed, anchor);

    expect(zoomed.scale).toBeCloseTo(1.25, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("连续缩放仍保持锚点（不漂移）", () => {
    let viewport: Viewport = { x: 10, y: 10, scale: 1 };
    const anchor = { x: 333, y: 222 };
    const before = screenToCanvas(viewport, anchor);
    for (let i = 0; i < 8; i++) viewport = zoomAt(viewport, 1.2, anchor);
    const after = screenToCanvas(viewport, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("缩到上限/下限时锚点依然不漂移", () => {
    const anchor = { x: 100, y: 100 };
    const atMax: Viewport = { x: 0, y: 0, scale: 1 };
    const zoomedMax = zoomAt(atMax, 100, anchor);
    expect(zoomedMax.scale).toBe(MAX_SCALE);
    const canvasPoint = screenToCanvas(atMax, anchor);
    const afterMax = screenToCanvas(zoomedMax, anchor);
    expect(afterMax.x).toBeCloseTo(canvasPoint.x, 6);

    const zoomedMin = zoomAt({ x: 0, y: 0, scale: 1 }, 0.0001, anchor);
    expect(zoomedMin.scale).toBe(MIN_SCALE);
    const afterMin = screenToCanvas(zoomedMin, anchor);
    expect(afterMin.x).toBeCloseTo(canvasPoint.x, 6);
  });

  it("锚点非法（NaN）时只改倍率、不产生 NaN 坐标", () => {
    const zoomed = zoomAt({ x: 5, y: 5, scale: 1 }, 2, { x: Number.NaN, y: 0 });
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBe(5);
  });
});

describe("zoomTo / panBy", () => {
  it("zoomTo 直达目标倍率且保持锚点", () => {
    const anchor = { x: 200, y: 150 };
    const before = screenToCanvas({ x: 0, y: 0, scale: 1 }, anchor);
    const next = zoomTo({ x: 0, y: 0, scale: 1 }, 2.5, anchor);
    expect(next.scale).toBe(2.5);
    const after = screenToCanvas(next, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
  });

  it("panBy 只平移偏移量", () => {
    expect(panBy({ x: 1, y: 2, scale: 3 }, 10, -5)).toEqual({ x: 11, y: -3, scale: 3 });
  });
});

describe("fitToRect / visibleRect / formatZoom", () => {
  it("把内容放进视口中央并留出内边距", () => {
    const viewport = fitToRect(
      { x: 100, y: 100, width: 200, height: 100 },
      { width: 800, height: 600 },
      50,
    );
    // 内容中心落在视口中心
    const center = canvasToScreen(viewport, { x: 200, y: 150 });
    expect(center.x).toBeCloseTo(400, 6);
    expect(center.y).toBeCloseTo(300, 6);
    // 内容完整落在视口内
    const topLeft = canvasToScreen(viewport, { x: 100, y: 100 });
    const bottomRight = canvasToScreen(viewport, { x: 300, y: 200 });
    expect(topLeft.x).toBeGreaterThanOrEqual(50 - 1e-6);
    expect(bottomRight.x).toBeLessThanOrEqual(750 + 1e-6);
  });

  it("空内容 / 零尺寸视口回落到默认视口", () => {
    expect(fitToRect(null, { width: 800, height: 600 })).toEqual(DEFAULT_VIEWPORT);
    expect(
      fitToRect({ x: 0, y: 0, width: 0, height: 0 }, { width: 800, height: 600 }),
    ).toEqual(DEFAULT_VIEWPORT);
    expect(
      fitToRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }),
    ).toEqual(DEFAULT_VIEWPORT);
  });

  it("visibleRect 与视口尺寸/缩放一致", () => {
    const rect = visibleRect({ x: -100, y: -100, scale: 2 }, { width: 800, height: 600 });
    expect(rect.x).toBeCloseTo(50, 6);
    expect(rect.y).toBeCloseTo(50, 6);
    expect(rect.width).toBeCloseTo(400, 6);
    expect(rect.height).toBeCloseTo(300, 6);
  });

  it("formatZoom 取整百分比并夹取", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.425)).toBe("43%");
    expect(formatZoom(99)).toBe(`${Math.round(MAX_SCALE * 100)}%`);
  });

  it("centerOf 给出视口中心", () => {
    expect(centerOf({ width: 800, height: 600 })).toEqual({ x: 400, y: 300 });
  });

  it("GRID_SIZE 为正数（网格绘制依赖）", () => {
    expect(GRID_SIZE).toBeGreaterThan(0);
  });
});
