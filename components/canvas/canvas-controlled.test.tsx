// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasViewport } from "./CanvasViewport";
import type { CanvasNode } from "@/lib/canvas/canvas-node";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pointerEvent(type: string, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ...props,
  });
  return event;
}

const NODES: CanvasNode[] = [
  { id: "a", type: "component", x: 0, y: 0, width: 100, height: 100, zIndex: 1, label: "A", componentId: "a" },
  { id: "b", type: "image", x: 200, y: 0, width: 100, height: 100, zIndex: 2, label: "B" },
];

/** 受控宿主：模拟工作区持有 nodes / selection */
function Harness({
  onNodes,
  dragGroup,
}: {
  onNodes?: (nodes: CanvasNode[]) => void;
  dragGroup?: (id: string) => string[];
}) {
  const [nodes, setNodes] = useState<CanvasNode[]>(NODES);
  const [selection, setSelection] = useState<string[]>([]);
  return (
    <CanvasViewport
      nodes={nodes}
      onNodesChange={(next) => {
        onNodes?.(next);
        setNodes(next);
      }}
      selection={selection}
      onSelectionChange={setSelection}
      dragGroup={dragGroup}
    />
  );
}

describe("CanvasViewport 受控模式", () => {
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

  it("受控节点被渲染，且不回落到内部状态", () => {
    act(() => root.render(<Harness />));
    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(2);
    expect(container.textContent).toContain("图层（2）");
  });

  it("拖动把新几何经 onNodesChange 回传（受控层是唯一真相）", () => {
    const onNodes = vi.fn();
    act(() => root.render(<Harness onNodes={onNodes} />));
    const surface = $("[data-canvas-surface]");
    const nodeA = $('[data-canvas-node="a"]');
    act(() => {
      nodeA.dispatchEvent(pointerEvent("pointerdown", { clientX: 50, clientY: 50 }));
      surface.dispatchEvent(pointerEvent("pointermove", { clientX: 60, clientY: 50 }));
      surface.dispatchEvent(pointerEvent("pointerup", { clientX: 60, clientY: 50 }));
    });
    expect($('[data-canvas-node="a"]').style.left).toBe("10px");
    expect(onNodes).toHaveBeenCalled();
    const latest = onNodes.mock.calls.at(-1)?.[0] as CanvasNode[];
    expect(latest.find((n) => n.id === "a")?.x).toBe(10);
  });

  it("dragGroup 让拖动一并移动指定节点（组件树拖父带子）", () => {
    act(() => root.render(<Harness dragGroup={(id) => (id === "a" ? ["a", "b"] : [id])} />));
    const surface = $("[data-canvas-surface]");
    act(() => {
      $('[data-canvas-node="a"]').dispatchEvent(
        pointerEvent("pointerdown", { clientX: 50, clientY: 50 }),
      );
      surface.dispatchEvent(pointerEvent("pointermove", { clientX: 60, clientY: 50 }));
      surface.dispatchEvent(pointerEvent("pointerup", { clientX: 60, clientY: 50 }));
    });
    expect($('[data-canvas-node="a"]').style.left).toBe("10px");
    expect($('[data-canvas-node="b"]').style.left).toBe("210px");
  });

  it("受控选择：点击图层外部回传选中 id", () => {
    act(() => root.render(<Harness />));
    act(() => $('[data-canvas-layer="a"]').click());
    expect($('[data-canvas-layer="a"]').getAttribute("aria-pressed")).toBe("true");
    // 单选应给出 8 个缩放手柄
    expect(container.querySelectorAll("[data-canvas-handle]")).toHaveLength(8);
  });

  it("showLayers=false 隐藏图层面板（display:none，不占位）", () => {
    act(() =>
      root.render(
        <CanvasViewport nodes={NODES} showLayers={false} showProperties={false} />,
      ),
    );
    expect($("[data-canvas-layers]").style.display).toBe("none");
    expect($("[data-canvas-properties]").style.display).toBe("none");
  });

  it("renderOverlay 收到视口与尺寸（供父子连线绘制）", () => {
    const overlay = vi.fn(() => <span data-test-overlay />);
    act(() => root.render(<CanvasViewport nodes={NODES} renderOverlay={overlay} />));
    expect(container.querySelector("[data-test-overlay]")).not.toBeNull();
    expect(overlay).toHaveBeenCalled();
    const [viewport, size] = (overlay.mock.calls.at(-1) ?? []) as unknown as [
      unknown,
      { width: number },
    ];
    expect(viewport).toMatchObject({ scale: 1 });
    expect(typeof size.width).toBe("number");
  });

  it("默认（非受控）路径不受影响：静态渲染含图层与属性面板", () => {
    const html = renderToStaticMarkup(<CanvasViewport />);
    expect(html).toContain("data-canvas-layers");
    expect(html).toContain("data-canvas-properties");
  });
});
