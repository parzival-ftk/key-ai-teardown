/**
 * 无限画布视口数学（W29，纯函数）。
 *
 * 坐标系约定（**只有一条**，组件与测试共用）：
 *   - canvas 坐标：节点自己的坐标系，原点 (0,0) 在画布左上；
 *   - screen 坐标：视口（DOM）坐标系；
 *   - `Viewport.x/y` = **画布原点在屏幕上的位置**，`scale` = 缩放倍率。
 *
 * 由此得到两条互为逆变换的映射：
 *   screen = canvas * scale + offset
 *   canvas = (screen - offset) / scale
 *
 * 缩放以光标为锚点（`zoomAt`）：光标下的画布点缩放前后必须**原地不动** ——
 * 这是无限画布最容易被做错的地方，也是最值得写成不变量断言的地方。
 *
 * 纯函数、零依赖、零 DOM 测量；可在 Node 下单测（不需要 jsdom）。
 */

export interface Viewport {
  /** 画布原点在屏幕上的 x */
  x: number;
  /** 画布原点在屏幕上的 y */
  y: number;
  /** 缩放倍率 */
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 缩放上下限 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

/** 背景网格步长（canvas 坐标） */
export const GRID_SIZE = 20;

/** 缩放按钮的单步倍率 */
export const ZOOM_STEP = 1.2;

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

/** 夹取缩放倍率；非法值（NaN/Infinity）回落到 1 */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function canvasToScreen(viewport: Viewport, point: Point): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

export function screenToCanvas(viewport: Viewport, point: Point): Point {
  const scale = viewport.scale === 0 ? 1 : viewport.scale;
  return {
    x: (point.x - viewport.x) / scale,
    y: (point.y - viewport.y) / scale,
  };
}

/** 平移（屏幕像素增量） */
export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...viewport, x: viewport.x + dxScreen, y: viewport.y + dyScreen };
}

/**
 * 以屏幕锚点为中心缩放：锚点下的画布坐标在缩放前后保持不变。
 * 倍率被夹取；锚点非法（NaN）时退化为仅改倍率。
 */
export function zoomAt(
  viewport: Viewport,
  factor: number,
  anchor: Point,
): Viewport {
  const scale = clampScale(viewport.scale * factor);
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return { ...viewport, scale };
  }
  const canvasPoint = screenToCanvas(viewport, anchor);
  return {
    scale,
    x: anchor.x - canvasPoint.x * scale,
    y: anchor.y - canvasPoint.y * scale,
  };
}

/** 缩放到指定倍率（仍以锚点为中心） */
export function zoomTo(
  viewport: Viewport,
  targetScale: number,
  anchor: Point,
): Viewport {
  const scale = clampScale(targetScale);
  const factor = viewport.scale === 0 ? 1 : scale / viewport.scale;
  return zoomAt(viewport, factor, anchor);
}

/** 屏幕中心（用于按钮缩放等无光标场景） */
export function centerOf(size: Size): Point {
  return { x: size.width / 2, y: size.height / 2 };
}

/** 把一组矩形放进视口中央（内容为空时返回默认视口） */
export function fitToRect(
  bounds: Rect | null,
  viewportSize: Size,
  padding = 48,
): Viewport {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { ...DEFAULT_VIEWPORT };
  if (viewportSize.width <= 0 || viewportSize.height <= 0) return { ...DEFAULT_VIEWPORT };

  const availableW = Math.max(1, viewportSize.width - padding * 2);
  const availableH = Math.max(1, viewportSize.height - padding * 2);
  const scale = clampScale(
    Math.min(availableW / bounds.width, availableH / bounds.height),
  );
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    scale,
    x: viewportSize.width / 2 - centerX * scale,
    y: viewportSize.height / 2 - centerY * scale,
  };
}

/** 视口里可见的画布区域（供裁剪/网格绘制用） */
export function visibleRect(viewport: Viewport, viewportSize: Size): Rect {
  const topLeft = screenToCanvas(viewport, { x: 0, y: 0 });
  const bottomRight = screenToCanvas(viewport, {
    x: viewportSize.width,
    y: viewportSize.height,
  });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/** 缩放百分比文案（如 100% / 42%） */
export function formatZoom(scale: number): string {
  return `${Math.round(clampScale(scale) * 100)}%`;
}
