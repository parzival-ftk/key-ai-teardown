// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComponentTreePanel } from "./ComponentTreePanel";
import { createExampleProject } from "@/lib/components/demo-project";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tree = createExampleProject(1000).tree;

describe("ComponentTreePanel", () => {
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
  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;

  it("按层级渲染（深度由 data-depth 标注）", () => {
    act(() => root.render(<ComponentTreePanel tree={tree} selection={[]} onSelect={vi.fn()} />));
    const nodes = container.querySelectorAll("[data-tree-node]");
    expect(nodes.length).toBe(Object.keys(tree.nodes).length);
    expect($('[data-tree-node="n1"]').getAttribute("data-depth")).toBe("0");
    // Hero 的子在更深一层
    const heroId = Object.values(tree.nodes).find((n) => n.name === "主视觉")!.id;
    const titleId = Object.values(tree.nodes).find((n) => n.name === "标题")!.id;
    expect(Number($(`[data-tree-node="${titleId}"]`).getAttribute("data-depth"))).toBe(
      Number($(`[data-tree-node="${heroId}"]`).getAttribute("data-depth")) + 1,
    );
  });

  it("点击节点回传 id", () => {
    const onSelect = vi.fn();
    act(() => root.render(<ComponentTreePanel tree={tree} selection={[]} onSelect={onSelect} />));
    const id = Object.values(tree.nodes).find((n) => n.name === "搜索框")!.id;
    act(() => $(`[data-tree-node="${id}"]`).click());
    expect(onSelect).toHaveBeenCalledWith(id);
  });

  it("选中项标记 aria-pressed", () => {
    const id = Object.values(tree.nodes).find((n) => n.name === "主视觉")!.id;
    act(() => root.render(<ComponentTreePanel tree={tree} selection={[id]} onSelect={vi.fn()} />));
    expect($(`[data-tree-node="${id}"]`).getAttribute("aria-pressed")).toBe("true");
  });

  it("空树显示空态", () => {
    act(() =>
      root.render(<ComponentTreePanel tree={{ rootId: "n1", nodes: {} }} selection={[]} onSelect={vi.fn()} />),
    );
    expect($("[data-component-tree-empty]")).not.toBeNull();
  });
});
