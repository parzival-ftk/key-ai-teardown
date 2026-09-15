import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import {
  TAILWIND_COLORS,
  TAILWIND_FONT_SIZE,
  TAILWIND_FONT_WEIGHT,
  TAILWIND_RADIUS,
  TAILWIND_SPACING,
  TAILWIND_SPECIAL_COLORS,
} from "./tailwind-tokens";

/**
 * W17 · HTML/Tailwind → Figma JSON 转换引擎。
 *
 * 把「界面代码」Agent 产出的 HTML + Tailwind 片段（参考起点，非复刻）转换为
 * **Figma REST API 的 Node JSON 结构**（DOCUMENT → CANVAS → FRAME/TEXT/COMPONENT），
 * 供 JSON-to-Figma 类插件或轻量原型工具导入，生成可编辑的设计图层。
 *
 * 设计取舍：
 * - **零新增依赖**：复用本仓既有的 cheerio（`lib/parsers/url.ts` 已用）做容错 HTML 解析；
 * - **近似布局 + 设计语义优先**：无法从静态 HTML 得知真实像素盒模型，故宽高为启发式估算、
 *   子节点按纵向堆叠占位（x/y 仅保证不重叠），**颜色 / 内边距 / 圆角 / 字号 / 字重等设计令牌是精确的**；
 * - **永不抛错**：非标准 HTML、缺失样式、未知标签一律降级（安全初始值 / FRAME 兜底），
 *   与项目一贯的「单点失败不阻塞」一致。
 *
 * 纯函数（无 DOM / 网络），可在 Node 单测与 Next.js server runtime 中直接运行。
 */

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: "SOLID";
  color: FigmaColor;
  opacity?: number;
}

export type FigmaNodeType = "DOCUMENT" | "CANVAS" | "FRAME" | "TEXT" | "COMPONENT";

export interface FigmaNode {
  id: string;
  name: string;
  type: FigmaNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  /** 填充（背景色 / 文本色），缺省表示无填充 */
  fills?: FigmaPaint[];
  cornerRadius?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  opacity?: number;
  /** 仅 TEXT：文本内容 */
  characters?: string;
  /** 仅 TEXT：字号（px） */
  fontSize?: number;
  /** 仅 TEXT：字重（100–900） */
  fontWeight?: number;
  children?: FigmaNode[];
}

export interface FigmaDocument {
  name: string;
  type: "DOCUMENT";
  children: FigmaNode[];
}

/** 解析后的 Tailwind 样式补丁（内部中间表示） */
export interface ParsedTailwindStyle {
  background?: FigmaPaint;
  textColor?: FigmaColor;
  padding?: { top: number; right: number; bottom: number; left: number };
  cornerRadius?: number;
  fontSize?: number;
  fontWeight?: number;
  itemSpacing?: number;
  layoutMode?: "HORIZONTAL" | "VERTICAL";
  opacity?: number;
}

/** 文本类标签 → TEXT 节点（内容即 characters） */
const TEXT_TAGS = new Set([
  "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "a", "label", "strong",
  "em", "small", "code", "pre", "blockquote", "figcaption", "li", "dt", "dd",
  "th", "td", "caption", "time", "abbr",
]);

/** 交互控件标签 → COMPONENT 节点 */
const COMPONENT_TAGS = new Set(["button"]);

/** 不参与导出的噪声标签 */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "link", "meta"]);

const DEFAULT_FRAME_WIDTH = 320;
const DEFAULT_COMPONENT_WIDTH = 120;
const DEFAULT_COMPONENT_HEIGHT = 40;
/** 文本行高系数（相对字号） */
const LINE_HEIGHT_RATIO = 1.5;
/** 单字符平均宽度系数（相对字号；CJK 偏宽、拉丁偏窄，取折中） */
const CHAR_WIDTH_RATIO = 0.65;
const MIN_TEXT_HEIGHT = 16;

const SAFE_ZERO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** `#rrggbb` / `#rgb` → Figma RGBA（0–1）。非法输入返回 null（调用方据此降级）。 */
export function hexToFigmaColor(hex: string): FigmaColor | null {
  const raw = (hex ?? "").trim();
  const short = /^#([0-9a-f]{3})$/i.exec(raw);
  const full = short
    ? `#${short[1].split("").map((c) => c + c).join("")}`
    : raw;
  const m = /^#([0-9a-f]{6})$/i.exec(full);
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
    a: 1,
  };
}

/** Tailwind 颜色 token（`blue-500` / `white`）→ sRGB hex；未知返回 null。 */
export function resolveTailwindColor(token: string): string | null {
  const special = TAILWIND_SPECIAL_COLORS[token];
  if (special) return special;
  const m = /^([a-z]+)-(\d+)$/.exec(token);
  if (!m) return null;
  return TAILWIND_COLORS[m[1]]?.[m[2]] ?? null;
}

/**
 * 解析 Tailwind 类串 → 样式补丁。
 * 只识别**基础工具类**（无变体/响应式前缀，含 `:` 的类一律忽略）；无法识别的类静默跳过。
 */
export function parseTailwindStyle(className: string): ParsedTailwindStyle {
  const out: ParsedTailwindStyle = {};
  const padding = { top: 0, right: 0, bottom: 0, left: 0 };
  let hasPadding = false;

  for (const cls of (className ?? "").split(/\s+/).filter(Boolean)) {
    // 变体 / 响应式 / 状态前缀（hover:、md:、dark: 等）无法静态求值 → 跳过
    if (cls.includes(":")) continue;

    const bg = /^bg-(.+)$/.exec(cls);
    if (bg) {
      const hex = resolveTailwindColor(bg[1]);
      const color = hex ? hexToFigmaColor(hex) : null;
      if (color) out.background = { type: "SOLID", color };
      continue;
    }

    const text = /^text-(.+)$/.exec(cls);
    if (text) {
      const token = text[1];
      // 先判字号（text-xl），再判颜色（text-white），最后忽略（text-center 等）
      if (TAILWIND_FONT_SIZE[token] !== undefined) {
        out.fontSize = TAILWIND_FONT_SIZE[token];
      } else {
        const hex = resolveTailwindColor(token);
        const color = hex ? hexToFigmaColor(hex) : null;
        if (color) out.textColor = color;
      }
      continue;
    }

    const pad = /^(p|px|py|pt|pr|pb|pl)-(.+)$/.exec(cls);
    if (pad) {
      const value = TAILWIND_SPACING[pad[2]];
      if (value !== undefined) {
        hasPadding = true;
        const dir = pad[1];
        if (dir === "p") {
          padding.top = padding.right = padding.bottom = padding.left = value;
        } else if (dir === "px") {
          padding.left = padding.right = value;
        } else if (dir === "py") {
          padding.top = padding.bottom = value;
        } else if (dir === "pt") padding.top = value;
        else if (dir === "pr") padding.right = value;
        else if (dir === "pb") padding.bottom = value;
        else if (dir === "pl") padding.left = value;
      }
      continue;
    }

    if (cls === "rounded") {
      out.cornerRadius = TAILWIND_RADIUS.DEFAULT;
      continue;
    }
    const rounded = /^rounded-(.+)$/.exec(cls);
    if (rounded) {
      const value = TAILWIND_RADIUS[rounded[1]];
      if (value !== undefined) out.cornerRadius = value;
      continue;
    }

    const font = /^font-(.+)$/.exec(cls);
    if (font) {
      const value = TAILWIND_FONT_WEIGHT[font[1]];
      if (value !== undefined) out.fontWeight = value;
      continue;
    }

    const gap = /^gap-(.+)$/.exec(cls);
    if (gap) {
      const value = TAILWIND_SPACING[gap[1]];
      if (value !== undefined) out.itemSpacing = value;
      continue;
    }

    const opacity = /^opacity-(\d{1,3})$/.exec(cls);
    if (opacity) {
      const n = Number.parseInt(opacity[1], 10);
      if (n >= 0 && n <= 100) out.opacity = n / 100;
      continue;
    }

    if (cls === "flex-col") out.layoutMode = "VERTICAL";
    else if (cls === "flex-row") out.layoutMode = "HORIZONTAL";
  }

  if (hasPadding) out.padding = padding;
  return out;
}

/** TEXT 节点的宽度估算（无真实盒模型，按字符数与字号启发式推算） */
function estimateTextWidth(characters: string, fontSize: number): number {
  const size = fontSize || TAILWIND_FONT_SIZE.base;
  return Math.max(1, Math.round(characters.length * size * CHAR_WIDTH_RATIO));
}

function estimateTextHeight(fontSize: number): number {
  const size = fontSize || TAILWIND_FONT_SIZE.base;
  return Math.max(MIN_TEXT_HEIGHT, Math.round(size * LINE_HEIGHT_RATIO));
}

function classOf(el: Element): string {
  const cls = el.attribs?.class ?? el.attribs?.className ?? "";
  return typeof cls === "string" ? cls : "";
}

/** 子节点纵向堆叠占位：x 取父内左边距，y 依次累加（保证不重叠，非精确布局） */
function stackChildren(children: FigmaNode[], leftPad: number, itemSpacing: number): void {
  let y = 0;
  for (const child of children) {
    child.x = leftPad;
    child.y = y;
    y += child.height + itemSpacing;
  }
}

function buildChildren(
  $: cheerio.CheerioAPI,
  parent: cheerio.Cheerio<AnyNode>,
  nextId: () => string,
): FigmaNode[] {
  const out: FigmaNode[] = [];
  parent.contents().each((_, child) => {
    if (child.type === "text") {
      const text = (child.data ?? "").replace(/\s+/g, " ").trim();
      if (text) out.push(makeTextNode(text, nextId, {}));
      return;
    }
    if (child.type !== "tag") return; // 注释 / 指令等忽略
    const el = child as Element;
    const tag = (el.name ?? "").toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    out.push(buildNode($, $(el as AnyNode), tag, nextId));
  });
  return out;
}

function makeTextNode(
  characters: string,
  nextId: () => string,
  style: ParsedTailwindStyle,
  name = "#text",
): FigmaNode {
  const fontSize = style.fontSize ?? TAILWIND_FONT_SIZE.base;
  const node: FigmaNode = {
    id: nextId(),
    name,
    type: "TEXT",
    x: 0,
    y: 0,
    width: estimateTextWidth(characters, fontSize),
    height: estimateTextHeight(fontSize),
    visible: true,
    characters,
    fontSize,
  };
  if (style.textColor) node.fills = [{ type: "SOLID", color: style.textColor }];
  if (style.fontWeight !== undefined) node.fontWeight = style.fontWeight;
  if (style.opacity !== undefined) node.opacity = style.opacity;
  return node;
}

function buildNode(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  tag: string,
  nextId: () => string,
): FigmaNode {
  const style = parseTailwindStyle(classOf($el.get(0) as Element));

  if (TEXT_TAGS.has(tag)) {
    const characters = $el.text().replace(/\s+/g, " ").trim();
    return makeTextNode(characters, nextId, style, tag);
  }

  const isComponent = COMPONENT_TAGS.has(tag);
  const children = buildChildren($, $el, nextId);
  const padding = style.padding ?? SAFE_ZERO_PADDING;
  const itemSpacing = style.itemSpacing ?? 0;

  // 高度：内容（子节点）高度 + 上下内边距；无子节点时退化为内边距之和
  const contentHeight = children.reduce(
    (sum, c, i) => sum + c.height + (i > 0 ? itemSpacing : 0),
    0,
  );
  const height =
    (isComponent ? DEFAULT_COMPONENT_HEIGHT : 0) +
    contentHeight +
    padding.top +
    padding.bottom;

  const node: FigmaNode = {
    id: nextId(),
    name: tag,
    type: isComponent ? "COMPONENT" : "FRAME",
    x: 0,
    y: 0,
    width: isComponent ? DEFAULT_COMPONENT_WIDTH : DEFAULT_FRAME_WIDTH,
    height: Math.max(1, Math.round(height)),
    visible: true,
    children,
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
  };
  if (style.background) node.fills = [style.background];
  if (style.cornerRadius !== undefined) node.cornerRadius = style.cornerRadius;
  if (style.itemSpacing !== undefined) node.itemSpacing = style.itemSpacing;
  if (style.layoutMode !== undefined) node.layoutMode = style.layoutMode;
  if (style.opacity !== undefined) node.opacity = style.opacity;

  stackChildren(children, padding.left, itemSpacing);
  return node;
}

/**
 * 主入口：HTML 片段 → Figma 文档树。
 * 结构为 DOCUMENT → CANVAS（画布）→ 解析出的节点。空/非法输入返回空画布，绝不抛错。
 */
export function htmlToFigmaDocument(
  html: string,
  options: { name?: string } = {},
): FigmaDocument {
  let seq = 0;
  const nextId = (): string => `node:${++seq}`;

  let nodes: FigmaNode[] = [];
  try {
    const $ = cheerio.load(html ?? "");
    nodes = buildChildren($, $("body"), nextId);
  } catch {
    // 解析异常兜底：返回空画布而非抛错（调用方仍可展示/下载结构）
    nodes = [];
  }

  stackChildren(nodes, 0, 0);

  const canvas: FigmaNode = {
    id: nextId(),
    name: "Page 1",
    type: "CANVAS",
    x: 0,
    y: 0,
    width: DEFAULT_FRAME_WIDTH,
    height: Math.max(1, nodes.reduce((sum, n) => sum + n.height, 0)),
    visible: true,
    children: nodes,
  };

  return {
    name: (options.name ?? "").trim() || "Key · Figma Export",
    type: "DOCUMENT",
    children: [canvas],
  };
}

/** 文档 → 美化 JSON 字符串（供弹窗展示 / 复制 / 下载）。 */
export function figmaDocumentToJson(doc: FigmaDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** 便于外部（如 UI 层统计节点数）遍历 —— 不改变结构。 */
export function countFigmaNodes(doc: FigmaDocument): number {
  let count = 0;
  const walk = (n: FigmaNode | FigmaDocument): void => {
    count += 1;
    for (const c of n.children ?? []) walk(c);
  };
  walk(doc);
  return count;
}
