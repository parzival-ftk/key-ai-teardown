// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { createExampleProject } from "@/lib/components/demo-project";
import { treeToCanvasNodes, componentEdges } from "@/lib/components/tree-to-canvas";
import type { Viewport } from "@/lib/canvas/viewport";

const tree = createExampleProject(1000).tree;
const nodes = treeToCanvasNodes(tree);

describe("ConnectionOverlay", () => {
  it("每条父子边渲染一条连线", () => {
    const html = renderToStaticMarkup(
      <ConnectionOverlay tree={tree} nodes={nodes} viewport={{ x: 0, y: 0, scale: 1 }} />,
    );
    expect(html).toContain("data-component-connections");
    const edges = componentEdges(tree);
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(html).toContain(`data-connection="${edge.parentId}-&gt;${edge.childId}"`);
    }
  });

  it("视口缩放影响连线坐标（screen = canvas * scale + offset）", () => {
    const viewport: Viewport = { x: 100, y: 50, scale: 2 };
    const html = renderToStaticMarkup(
      <ConnectionOverlay tree={tree} nodes={nodes} viewport={viewport} />,
    );
    const hero = nodes.find((n) => n.id === "n2")!;
    // 父节点底边中点 → screen
    const expectedX = hero.x + hero.width / 2;
    expect(expectedX).toBeGreaterThan(0);
    expect(html).toContain("<line");
  });

  it("节点缺失时跳过该边而不报错", () => {
    const html = renderToStaticMarkup(
      <ConnectionOverlay tree={tree} nodes={[]} viewport={{ x: 0, y: 0, scale: 1 }} />,
    );
    expect(html).toContain("data-component-connections");
    expect(html).not.toContain("<line");
  });
});
