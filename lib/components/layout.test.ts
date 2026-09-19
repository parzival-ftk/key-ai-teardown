import { describe, it, expect } from "vitest";
import { DEFAULT_LAYOUT, ensureRects, hasCompleteRects, layoutTree } from "./layout";
import { treeFromRaw, updateComponent } from "./tree";
import type { RawComponentNode } from "./schema";

const SAMPLE: RawComponentNode = {
  name: "Landing Page",
  children: [
    { name: "Header" },
    { name: "Hero", children: [{ name: "Title" }, { name: "SearchBox" }] },
    { name: "Footer" },
  ],
};

describe("hasCompleteRects", () => {
  it("未经布局的树宽高为 0 → false", () => {
    expect(hasCompleteRects(treeFromRaw(SAMPLE))).toBe(false);
  });

  it("每个节点都有正宽高 → true", () => {
    const tree = layoutTree(treeFromRaw(SAMPLE));
    expect(hasCompleteRects(tree)).toBe(true);
  });
});

describe("layoutTree", () => {
  it("x 随深度缩进，y 随 DFS 行号递增", () => {
    const tree = layoutTree(treeFromRaw(SAMPLE));
    // 根：depth 0，行 0
    expect(tree.nodes.n1.rect).toEqual({
      x: DEFAULT_LAYOUT.originX,
      y: DEFAULT_LAYOUT.originY,
      width: DEFAULT_LAYOUT.nodeWidth,
      height: DEFAULT_LAYOUT.nodeHeight,
    });
    // Header：depth 1，行 1
    expect(tree.nodes.n2.rect.x).toBe(
      DEFAULT_LAYOUT.originX + (DEFAULT_LAYOUT.nodeWidth + DEFAULT_LAYOUT.gapX),
    );
    expect(tree.nodes.n2.rect.y).toBe(
      DEFAULT_LAYOUT.originY + (DEFAULT_LAYOUT.nodeHeight + DEFAULT_LAYOUT.gapY),
    );
    // Title：depth 2，行 2
    expect(tree.nodes.n4.rect.x).toBe(
      DEFAULT_LAYOUT.originX + 2 * (DEFAULT_LAYOUT.nodeWidth + DEFAULT_LAYOUT.gapX),
    );
  });

  it("同一父下相邻兄弟纵向不相邻（行号连续递增）", () => {
    const tree = layoutTree(treeFromRaw(SAMPLE));
    const rowGap = DEFAULT_LAYOUT.nodeHeight + DEFAULT_LAYOUT.gapY;
    expect(tree.nodes.n5.rect.y - tree.nodes.n4.rect.y).toBe(rowGap);
  });

  it("接受自定义布局参数", () => {
    const tree = layoutTree(treeFromRaw(SAMPLE), { originX: 0, originY: 0, nodeWidth: 100, nodeHeight: 50, gapX: 10, gapY: 10 });
    expect(tree.nodes.n1.rect).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(tree.nodes.n2.rect.x).toBe(110);
  });
});

describe("ensureRects", () => {
  it("缺矩形时布局", () => {
    const laid = ensureRects(treeFromRaw(SAMPLE));
    expect(hasCompleteRects(laid)).toBe(true);
  });

  it("已有完整矩形时原样返回（同一引用，不重新布局）", () => {
    const laid = layoutTree(treeFromRaw(SAMPLE));
    expect(ensureRects(laid)).toBe(laid);
  });

  it("缺少任一矩形时对整棵树重排（布局是全量操作）", () => {
    const base = treeFromRaw(SAMPLE);
    const withOneRect = updateComponent(base, "n1", {
      rect: { x: 5, y: 6, width: 7, height: 8 },
    });
    // 仍有其它节点缺矩形 → 触发重排，n1 的坐标被布局覆盖
    const laid = ensureRects(withOneRect);
    expect(laid).not.toBe(withOneRect);
    expect(laid.nodes.n1.rect.x).toBe(DEFAULT_LAYOUT.originX);
  });
});
