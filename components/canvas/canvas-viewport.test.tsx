// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasViewport } from "./CanvasViewport";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom 没有 PointerEvent 构造器：用 Event 承载 React 需要的字段 */
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

describe("CanvasViewport（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(<CanvasViewport />);

  it("工具栏包含 4 个工具与缩放控件", () => {
    expect(html).toContain("data-canvas-toolbar");
    for (const tool of ["select", "frame", "prompt", "shape"]) {
      expect(html).toContain(`data-canvas-tool="${tool}"`);
    }
    expect(html).toContain("data-canvas-zoom");
    expect(html).toContain("data-canvas-zoom-in");
    expect(html).toContain("data-canvas-fit");
    expect(html).toContain("data-canvas-reset");
  });

  it("默认选中「选择」工具，缩放 100%", () => {
    expect(html).toContain('data-canvas-tool="select" aria-pressed="true"');
    expect(html).toMatch(/data-canvas-zoom[^>]*>100%/);
  });

  it("两侧面板：图层与属性（空态）", () => {
    expect(html).toContain("data-canvas-layers");
    expect(html).toContain("data-canvas-properties");
    expect(html).toContain("data-canvas-properties-empty");
  });

  it("注入初始节点时渲染节点与图层项", () => {
    const seeded = renderToStaticMarkup(
      <CanvasViewport
        initialNodes={[
          {
            id: "frame-1",
            type: "frame",
            x: 40,
            y: 60,
            width: 200,
            height: 120,
            zIndex: 1,
            label: "主画框",
          },
        ]}
      />,
    );
    expect(seeded).toContain('data-canvas-node="frame-1"');
    expect(seeded).toContain('data-canvas-layer="frame-1"');
    expect(seeded).toContain("图层（1）");
  });
});

describe("CanvasViewport 交互（jsdom）", () => {
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

  const mount = (nodes?: Parameters<typeof CanvasViewport>[0]["initialNodes"]) =>
    act(() => root.render(<CanvasViewport initialNodes={nodes} />));
  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const surface = () => $("[data-canvas-surface]");
  const zoomText = () => container.querySelector("[data-canvas-zoom]")?.textContent;

  it("切换工具改变 aria-pressed", () => {
    mount();
    act(() => $('[data-canvas-tool="frame"]').click());
    expect($('[data-canvas-tool="frame"]').getAttribute("aria-pressed")).toBe("true");
    expect($('[data-canvas-tool="select"]').getAttribute("aria-pressed")).toBe("false");
  });

  it("绘制工具下点击画布 → 新建节点并出现在图层面板", () => {
    mount();
    act(() => $('[data-canvas-tool="frame"]').click());

    const target = surface();
    act(() => {
      target.dispatchEvent(pointerEvent("pointerdown", { clientX: 120, clientY: 90 }));
    });
    act(() => {
      target.dispatchEvent(pointerEvent("pointerup", { clientX: 120, clientY: 90 }));
    });

    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-canvas-layer]")).toHaveLength(1);
    expect(container.textContent).toContain("图层（1）");
    // 创建后自动切回选择工具
    expect($('[data-canvas-tool="select"]').getAttribute("aria-pressed")).toBe("true");
    // 属性面板不再显示空态
    expect(container.querySelector("[data-canvas-properties-empty]")).toBeNull();
  });

  it("缩放按钮改变百分比并可回到 100%", () => {
    mount();
    expect(zoomText()).toBe("100%");
    act(() => $("[data-canvas-zoom-in]").click());
    expect(zoomText()).toBe("120%");
    act(() => $("[data-canvas-zoom-out]").click());
    expect(zoomText()).toBe("100%");
  });

  it("重置按钮把缩放恢复为 100%", () => {
    mount();
    act(() => $("[data-canvas-zoom-in]").click());
    act(() => $("[data-canvas-reset]").click());
    expect(zoomText()).toBe("100%");
  });

  it("删除按钮移除选中节点", () => {
    mount([
      { id: "a", type: "image", x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
    ]);
    act(() => $('[data-canvas-layer="a"]').click());
    expect(container.querySelector("[data-canvas-node]")).not.toBeNull();
    act(() => $('[data-canvas-action="delete"]').click());
    expect(container.querySelector("[data-canvas-node]")).toBeNull();
    expect(container.textContent).toContain("图层（0）");
  });

  it("属性面板可编辑坐标", () => {
    mount([
      { id: "a", type: "prompt", x: 0, y: 0, width: 100, height: 80, zIndex: 1 },
    ]);
    act(() => $('[data-canvas-layer="a"]').click());

    const input = container.querySelector('[data-canvas-prop="x"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input, "250");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const node = container.querySelector('[data-canvas-node="a"]') as HTMLElement;
    expect(node.style.left).toBe("250px");
  });

  it("拖拽移动以手势自身记录的目标为准（回归：不依赖 down/move 之间的重渲染）", () => {
    mount([
      { id: "a", type: "image", x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
      { id: "b", type: "image", x: 200, y: 0, width: 100, height: 100, zIndex: 2 },
    ]);
    const target = surface();
    const nodeA = container.querySelector('[data-canvas-node="a"]') as HTMLElement;
    const nodeB = container.querySelector('[data-canvas-node="b"]') as HTMLElement;

    // 三次派发放在同一个 act 内：React 不会在 down 与 move 之间重渲染
    act(() => {
      nodeA.dispatchEvent(pointerEvent("pointerdown", { clientX: 50, clientY: 50 }));
      target.dispatchEvent(pointerEvent("pointermove", { clientX: 60, clientY: 50 }));
      target.dispatchEvent(pointerEvent("pointerup", { clientX: 60, clientY: 50 }));
    });

    expect((container.querySelector('[data-canvas-node="a"]') as HTMLElement).style.left).toBe("10px");
    expect(nodeB.style.left).toBe("200px");
  });

  it("框选选中相交的多个节点（并显示包围盒、不给多选显示手柄）", () => {
    mount([
      { id: "a", type: "image", x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
      { id: "b", type: "image", x: 200, y: 0, width: 100, height: 100, zIndex: 2 },
    ]);
    const target = surface();
    act(() => {
      target.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      target.dispatchEvent(pointerEvent("pointermove", { clientX: 400, clientY: 200 }));
      target.dispatchEvent(pointerEvent("pointerup", { clientX: 400, clientY: 200 }));
    });
    expect(container.querySelector("[data-canvas-selection]")).not.toBeNull();
    expect(container.querySelectorAll("[data-canvas-handle]")).toHaveLength(0);
  });

  it("单选用包围盒给出 8 个缩放手柄", () => {
    mount([
      { id: "a", type: "image", x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
    ]);
    act(() => $('[data-canvas-layer="a"]').click());
    expect(container.querySelectorAll("[data-canvas-handle]")).toHaveLength(8);
  });

  it("图片节点真的把图画出来（回归：曾只画空框，看不出「结果落回画布」）", () => {
    mount([
      {
        id: "img-1",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        src: "data:image/png;base64,AAAA",
        label: "生成结果",
      },
    ]);
    const img = container.querySelector(
      '[data-canvas-node-image="img-1"]',
    ) as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img.getAttribute("draggable")).toBe("false");
  });

  it("prompt 节点显示文本；无 src 无 text 的节点不渲染图片", () => {
    mount([
      {
        id: "p-1",
        type: "prompt",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        zIndex: 1,
        text: "把这里换成一只猫",
      },
    ]);
    expect(container.textContent).toContain("把这里换成一只猫");
    expect(container.querySelector("[data-canvas-node-image]")).toBeNull();
  });
});
