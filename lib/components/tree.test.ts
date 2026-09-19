import { describe, it, expect } from "vitest";
import {
  ancestorsOf,
  childrenOf,
  countByType,
  depthOf,
  descendantsOf,
  findComponent,
  flattenTree,
  moveComponent,
  pathNamesOf,
  rootNode,
  treeFromRaw,
  updateComponent,
} from "./tree";
import type { RawComponentNode } from "./schema";

const SAMPLE: RawComponentNode = {
  name: "Landing Page",
  children: [
    { name: "Header" },
    {
      name: "Hero",
      children: [
        { name: "Title" },
        { name: "SearchBox" },
        { name: "Illustration" },
      ],
    },
    { name: "Features" },
    { name: "Footer" },
  ],
};

describe("treeFromRaw", () => {
  it("按 DFS 顺序分配确定性 id", () => {
    const tree = treeFromRaw(SAMPLE);
    // n1=root, n2=Header, n3=Hero, n4=Title, n5=SearchBox, n6=Illustration, n7=Features, n8=Footer
    expect(tree.rootId).toBe("n1");
    expect(tree.nodes.n2.name).toBe("Header");
    expect(tree.nodes.n6.name).toBe("Illustration");
    expect(tree.nodes.n8.name).toBe("Footer");
  });

  it("按深度推断类型：根=page、二级=section、更深=component", () => {
    const tree = treeFromRaw(SAMPLE);
    expect(tree.nodes.n1.type).toBe("page");
    expect(tree.nodes.n2.type).toBe("section");
    expect(tree.nodes.n4.type).toBe("component");
  });

  it("显式 type 优先于推断", () => {
    const tree = treeFromRaw({ name: "Root", type: "section", children: [{ name: "X", type: "element" }] });
    expect(tree.nodes.n1.type).toBe("section");
    expect(tree.nodes.n2.type).toBe("element");
  });

  it("父子引用互相一致", () => {
    const tree = treeFromRaw(SAMPLE);
    expect(tree.nodes.n3.children).toEqual(["n4", "n5", "n6"]);
    expect(tree.nodes.n4.parentId).toBe("n3");
    expect(tree.nodes.n3.parentId).toBe("n1");
    expect(tree.nodes.n1.parentId).toBeUndefined();
  });
});

describe("遍历", () => {
  it("flattenTree 含根且顺序与 DFS 一致", () => {
    const tree = treeFromRaw(SAMPLE);
    expect(flattenTree(tree).map((n) => n.name)).toEqual([
      "Landing Page",
      "Header",
      "Hero",
      "Title",
      "SearchBox",
      "Illustration",
      "Features",
      "Footer",
    ]);
  });

  it("childrenOf 保持 children 顺序", () => {
    const tree = treeFromRaw(SAMPLE);
    expect(childrenOf(tree, "n3").map((n) => n.name)).toEqual([
      "Title",
      "SearchBox",
      "Illustration",
    ]);
  });

  it("descendantsOf 不含自身，ancestorsOf／depthOf／pathNamesOf 正确", () => {
    const tree = treeFromRaw(SAMPLE);
    expect(descendantsOf(tree, "n3").map((n) => n.name)).toEqual([
      "Title",
      "SearchBox",
      "Illustration",
    ]);
    expect(ancestorsOf(tree, "n5").map((n) => n.name)).toEqual(["Hero", "Landing Page"]);
    expect(depthOf(tree, "n1")).toBe(0);
    expect(depthOf(tree, "n5")).toBe(2);
    expect(pathNamesOf(tree, "n5")).toEqual(["Landing Page", "Hero", "SearchBox"]);
  });

  it("环路数据不导致死循环", () => {
    const tree = treeFromRaw(SAMPLE);
    // 人为制造环：让根成为自己的后代
    const cyclic = {
      rootId: "n1",
      nodes: { ...tree.nodes, n1: { ...tree.nodes.n1, parentId: "n8" } },
    };
    expect(() => descendantsOf(cyclic, "n1")).not.toThrow();
    expect(ancestorsOf(cyclic, "n1").length).toBeLessThan(10);
  });

  it("countByType 统计各层级", () => {
    const tree = treeFromRaw(SAMPLE);
    expect(countByType(tree)).toEqual({ page: 1, section: 4, component: 3, element: 0 });
  });
});

describe("变更", () => {
  it("updateComponent 返回新对象且不改原树", () => {
    const tree = treeFromRaw(SAMPLE);
    const next = updateComponent(tree, "n5", { name: "搜索框" });
    expect(next).not.toBe(tree);
    expect(next.nodes.n5.name).toBe("搜索框");
    expect(tree.nodes.n5.name).toBe("SearchBox");
  });

  it("moveComponent 只改坐标，尺寸不变", () => {
    const tree = treeFromRaw(SAMPLE);
    const withRect = updateComponent(tree, "n5", { rect: { x: 1, y: 2, width: 30, height: 40 } });
    const moved = moveComponent(withRect, "n5", { x: 100, y: 200 });
    expect(moved.nodes.n5.rect).toEqual({ x: 100, y: 200, width: 30, height: 40 });
  });

  it("对不存在的 id 变更返回原树引用", () => {
    const tree = treeFromRaw(SAMPLE);
    expect(updateComponent(tree, "nope", { name: "x" })).toBe(tree);
    expect(findComponent(tree, "nope")).toBeNull();
    expect(rootNode(tree)?.name).toBe("Landing Page");
  });
});
