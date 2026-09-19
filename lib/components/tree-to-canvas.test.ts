import { describe, it, expect } from "vitest";
import {
  applyCanvasToTree,
  assetsToCanvasNodes,
  componentCanvasType,
  componentEdges,
  treeToCanvasNodes,
} from "./tree-to-canvas";
import { treeFromRaw } from "./tree";
import type { GeneratedAsset } from "./types";
import { createExampleProject } from "./demo-project";

const TREE = treeFromRaw({
  name: "Page",
  children: [
    { name: "Section", children: [{ name: "Button" }] },
  ],
});

describe("componentCanvasType", () => {
  it("page/section → frame，component/element → component", () => {
    expect(componentCanvasType("page")).toBe("frame");
    expect(componentCanvasType("section")).toBe("frame");
    expect(componentCanvasType("component")).toBe("component");
    expect(componentCanvasType("element")).toBe("component");
  });
});

describe("treeToCanvasNodes", () => {
  it("每个组件一个节点，id 即组件 id 并绑定 componentId", () => {
    const nodes = treeToCanvasNodes(TREE);
    expect(nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(nodes.every((n) => n.componentId === n.id)).toBe(true);
  });

  it("zIndex 取深度：父在子下（命中测试落到最具体组件）", () => {
    const nodes = treeToCanvasNodes(TREE);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId.n1.zIndex).toBe(0);
    expect(byId.n2.zIndex).toBe(1);
    expect(byId.n3.zIndex).toBe(2);
  });

  it("坐标取自组件矩形；宽高为 0 时回落到默认尺寸", () => {
    const nodes = treeToCanvasNodes(TREE);
    expect(nodes[0].width).toBeGreaterThan(0); // 缺矩形 → 默认 200×120
    const laid = treeFromRaw({ name: "P", rect: { x: 11, y: 22, width: 330, height: 44 } });
    expect(treeToCanvasNodes(laid)[0]).toMatchObject({ x: 11, y: 22, width: 330, height: 44 });
  });
});

describe("applyCanvasToTree", () => {
  it("几何未变时返回原树引用（避免无谓重渲染）", () => {
    const tree = createExampleProject(1000).tree;
    const nodes = treeToCanvasNodes(tree);
    expect(applyCanvasToTree(tree, nodes)).toBe(tree);
  });

  it("节点几何变化回写到组件矩形", () => {
    const tree = createExampleProject(1000).tree;
    const nodes = treeToCanvasNodes(tree).map((n) =>
      n.id === "n1" ? { ...n, x: n.x + 100, y: n.y + 50 } : n,
    );
    const next = applyCanvasToTree(tree, nodes);
    expect(next).not.toBe(tree);
    expect(next.nodes.n1.rect.x).toBe(tree.nodes.n1.rect.x + 100);
    expect(next.nodes.n1.rect.y).toBe(tree.nodes.n1.rect.y + 50);
  });

  it("忽略没有 componentId 的节点（资产图片不污染树）", () => {
    const tree = createExampleProject(1000).tree;
    const withAsset = [
      ...treeToCanvasNodes(tree),
      { id: "asset-1", type: "image" as const, x: 9, y: 9, width: 10, height: 10, zIndex: 99 },
    ];
    expect(applyCanvasToTree(tree, withAsset)).toBe(tree);
  });

  it("树 → 节点 → 树 往返稳定", () => {
    const tree = createExampleProject(1000).tree;
    expect(applyCanvasToTree(tree, treeToCanvasNodes(tree))).toEqual(tree);
  });
});

describe("assetsToCanvasNodes", () => {
  const asset: GeneratedAsset = {
    id: "a1",
    componentId: "n3",
    provider: "comfyui",
    prompt: "a cinematic futuristic city at night",
    artifactPath: "/tmp/a.png",
    url: "http://127.0.0.1:8188/view?filename=a.png",
    width: 512,
    height: 512,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("生成图片落在来源组件旁并绑定 componentId", () => {
    const nodes = assetsToCanvasNodes(TREE, [asset]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("image");
    expect(nodes[0].componentId).toBe("n3");
    expect(nodes[0].id).toBe("asset-a1");
    expect(nodes[0].src).toBe(asset.url);
  });

  it("没有 url 的资产不产生节点（图片不可展示）", () => {
    expect(assetsToCanvasNodes(TREE, [{ ...asset, url: undefined }])).toHaveLength(0);
  });
});

describe("componentEdges", () => {
  it("列出全部父子边", () => {
    expect(componentEdges(TREE)).toEqual([
      { parentId: "n1", childId: "n2" },
      { parentId: "n2", childId: "n3" },
    ]);
  });
});
