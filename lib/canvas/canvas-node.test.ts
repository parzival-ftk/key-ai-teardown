import { describe, it, expect } from "vitest";
import {
  MIN_NODE_SIZE,
  boundsOf,
  bringToFront,
  createCanvasNode,
  hitTest,
  moveNodes,
  nextZIndex,
  nodesInRect,
  normalizeRect,
  rectsIntersect,
  removeNodes,
  resizeNode,
  sendToBack,
  sortByZ,
  updateNode,
  type CanvasNode,
} from "./canvas-node";

const nodes: CanvasNode[] = [
  { id: "a", type: "frame", x: 0, y: 0, width: 200, height: 100, zIndex: 1 },
  { id: "b", type: "image", x: 100, y: 50, width: 100, height: 100, zIndex: 2 },
  { id: "c", type: "prompt", x: 400, y: 300, width: 120, height: 60, zIndex: 3 },
];

describe("createCanvasNode", () => {
  it("自动分配 id 与置顶 zIndex", () => {
    const node = createCanvasNode({ type: "image", x: 10, y: 20 }, nodes);
    expect(node.id).toBe("image-4");
    expect(node.zIndex).toBe(4);
    expect(node.width).toBeGreaterThan(0);
  });

  it("id 冲突时递增避让", () => {
    const node = createCanvasNode({ type: "frame", x: 0, y: 0, id: "a" }, nodes);
    expect(node.id).not.toBe("a");
    expect(nodes.some((n) => n.id === node.id)).toBe(false);
  });

  it("nextZIndex 从空集合开始为 1", () => {
    expect(nextZIndex([])).toBe(1);
  });
});

describe("sortByZ / hitTest", () => {
  it("按 zIndex 升序（同层保序）", () => {
    expect(sortByZ([nodes[2], nodes[0], nodes[1]]).map((n) => n.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const sameZ = [
      { ...nodes[0], id: "x" },
      { ...nodes[1], id: "y" },
    ].map((n) => ({ ...n, zIndex: 1 }));
    expect(sortByZ(sameZ).map((n) => n.id)).toEqual(["x", "y"]);
  });

  it("命中测试返回最上层节点", () => {
    expect(hitTest(nodes, { x: 150, y: 80 })?.id).toBe("b"); // 重叠区取 b（z=2）
    expect(hitTest(nodes, { x: 10, y: 10 })?.id).toBe("a");
    expect(hitTest(nodes, { x: 999, y: 999 })).toBeNull();
  });
});

describe("框选与包围盒", () => {
  it("框选按相交判定（碰到即选中）", () => {
    const rect = normalizeRect({ x: 90, y: 40 }, { x: 130, y: 90 });
    expect(nodesInRect(nodes, rect).map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("空矩形不选中任何节点", () => {
    expect(nodesInRect(nodes, { x: 700, y: 700, width: 10, height: 10 })).toEqual([]);
    expect(rectsIntersect({ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: 5, width: 1, height: 1 })).toBe(false);
  });

  it("包围盒为并集；空集合为 null", () => {
    expect(boundsOf(nodes)).toEqual({ x: 0, y: 0, width: 520, height: 360 });
    expect(boundsOf([])).toBeNull();
  });

  it("反向拖拽生成规范化矩形", () => {
    expect(normalizeRect({ x: 100, y: 100 }, { x: 40, y: 30 })).toEqual({
      x: 40,
      y: 30,
      width: 60,
      height: 70,
    });
  });
});

describe("moveNodes / updateNode / removeNodes", () => {
  it("批量平移只影响目标节点", () => {
    const moved = moveNodes(nodes, ["a", "b"], 10, -5);
    expect(moved.find((n) => n.id === "a")).toMatchObject({ x: 10, y: -5 });
    expect(moved.find((n) => n.id === "b")).toMatchObject({ x: 110, y: 45 });
    expect(moved.find((n) => n.id === "c")).toMatchObject({ x: 400, y: 300 });
  });

  it("不改动入参（不可变）", () => {
    const snapshot = JSON.parse(JSON.stringify(nodes));
    moveNodes(nodes, ["a"], 100, 100);
    updateNode(nodes, "a", { width: 999 });
    removeNodes(nodes, ["a"]);
    expect(nodes).toEqual(snapshot);
  });

  it("删除按 id 集合过滤", () => {
    expect(removeNodes(nodes, ["a", "c"]).map((n) => n.id)).toEqual(["b"]);
  });
});

describe("resizeNode：对侧边固定 + 最小尺寸", () => {
  const box: CanvasNode = {
    id: "n",
    type: "frame",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    zIndex: 1,
  };

  it("se 拉伸：左上角不动", () => {
    const out = resizeNode(box, "se", 40, 20);
    expect(out).toMatchObject({ x: 100, y: 100, width: 240, height: 120 });
  });

  it("nw 拉伸：右下角不动", () => {
    const out = resizeNode(box, "nw", -20, -10);
    expect(out.x + out.width).toBe(300);
    expect(out.y + out.height).toBe(200);
    expect(out).toMatchObject({ x: 80, y: 90, width: 220, height: 110 });
  });

  it("e / s 只改一条边", () => {
    expect(resizeNode(box, "e", 30, 999)).toMatchObject({ width: 230, height: 100 });
    expect(resizeNode(box, "s", 999, 30)).toMatchObject({ width: 200, height: 130 });
  });

  it("夹取最小边长时对侧边仍固定", () => {
    const out = resizeNode(box, "nw", 500, 500);
    expect(out.width).toBe(MIN_NODE_SIZE);
    expect(out.height).toBe(MIN_NODE_SIZE);
    // 右下角保持不动
    expect(out.x + out.width).toBe(300);
    expect(out.y + out.height).toBe(200);
  });
});

describe("层级操作", () => {
  it("bringToFront 提到最大 zIndex", () => {
    const out = bringToFront(nodes, "a");
    expect(out.find((n) => n.id === "a")?.zIndex).toBe(4);
  });

  it("sendToBack 压到最小 zIndex（其余节点不动）", () => {
    const out = sendToBack(nodes, "c");
    const target = out.find((n) => n.id === "c")!;
    expect(target.zIndex).toBeLessThan(1);
    expect(out.find((n) => n.id === "a")?.zIndex).toBe(1);
  });
});
