// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MermaidViewer, buildMermaidElementId } from "./MermaidViewer";
import type { MermaidRenderer } from "@/lib/diagram/render-mermaid";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("buildMermaidElementId（纯函数）", () => {
  it("同一实例键下随序号变化", () => {
    expect(buildMermaidElementId("r1", 1)).not.toBe(buildMermaidElementId("r1", 2));
  });

  it("不同实例键下即便序号相同也不同（回归：跨实例 id 撞车）", () => {
    expect(buildMermaidElementId("r1", 1)).not.toBe(buildMermaidElementId("r2", 1));
  });

  it("滤掉 React useId 里的冒号等非字母数字字符（否则 mermaid 生成的 #id 选择器非法）", () => {
    expect(buildMermaidElementId(":r0:", 1)).toBe("mermaid-r0-1");
  });
});

describe("MermaidViewer 多实例挂载（回归：跨实例 id 必须唯一）", () => {
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

  it("同页两张图并发渲染时，传给渲染器的 id 互不相同", async () => {
    const ids: string[] = [];
    const renderer: MermaidRenderer = async (_code, id) => {
      ids.push(id);
      return `<svg id="${id}"></svg>`;
    };

    await act(async () => {
      root.render(
        <>
          <MermaidViewer code="flowchart TD\n A-->B" renderer={renderer} />
          <MermaidViewer code="stateDiagram-v2\n [*] --> A" renderer={renderer} />
        </>,
      );
      await Promise.resolve();
    });

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("渲染成功后挂上 SVG 且状态转为 ok", async () => {
    const renderer: MermaidRenderer = async (_code, id) => `<svg id="${id}"></svg>`;
    await act(async () => {
      root.render(<MermaidViewer code="flowchart TD\n A-->B" renderer={renderer} />);
      await Promise.resolve();
    });
    const viewer = container.querySelector("[data-mermaid-viewer]");
    expect(viewer?.getAttribute("data-mermaid-status")).toBe("ok");
    expect(container.querySelector("[data-mermaid-svg] svg")).not.toBeNull();
  });

  it("渲染器抛错（非法语法）→ 降级为错误视图并展示源码", async () => {
    const renderer: MermaidRenderer = async () => {
      throw new Error("Parse error on line 2");
    };
    await act(async () => {
      root.render(<MermaidViewer code="flowchart TD\n ???" renderer={renderer} />);
      await Promise.resolve();
    });
    const viewer = container.querySelector("[data-mermaid-viewer]");
    expect(viewer?.getAttribute("data-mermaid-status")).toBe("error");
    expect(container.querySelector("[data-mermaid-error]")).not.toBeNull();
    expect(container.querySelector("[data-mermaid-fallback-source]")?.textContent).toContain(
      "flowchart TD",
    );
  });

  it("工具栏：放大 / 缩小 / 重置改变缩放百分比", async () => {
    const renderer: MermaidRenderer = async () => "<svg/>";
    await act(async () => {
      root.render(<MermaidViewer code="flowchart TD" renderer={renderer} />);
      await Promise.resolve();
    });
    const zoom = () => container.querySelector("[data-mermaid-zoom]")?.textContent;
    const click = async (action: string) => {
      await act(async () => {
        (
          container.querySelector(`[data-mermaid-action="${action}"]`) as HTMLElement
        ).click();
      });
    };

    expect(zoom()).toBe("100%");
    await click("zoom-in");
    expect(zoom()).toBe("120%");
    await click("zoom-out");
    expect(zoom()).toBe("100%");
    await click("zoom-in");
    await click("zoom-in");
    expect(zoom()).toBe("140%");
    await click("zoom-reset");
    expect(zoom()).toBe("100%");
  });

  it("全屏切换会改变容器样式与 aria-pressed", async () => {
    const renderer: MermaidRenderer = async () => "<svg/>";
    await act(async () => {
      root.render(<MermaidViewer code="flowchart TD" renderer={renderer} />);
      await Promise.resolve();
    });
    const button = container.querySelector(
      '[data-mermaid-action="fullscreen"]',
    ) as HTMLElement;
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector("[data-mermaid-viewer]")?.className,
    ).toContain("fixed inset-0");
  });

  // W18：状态图 → 导出 XState
  it("状态图点击『导出 XState』打开弹窗，展示机器 JSON", async () => {
    const renderer: MermaidRenderer = async () => "<svg/>";
    await act(async () => {
      root.render(
        <MermaidViewer
          code={"stateDiagram-v2\n  [*] --> A\n  A --> B : GO"}
          kind="state"
          renderer={renderer}
        />,
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-xstate-modal]")).toBeNull();

    await act(async () => {
      (
        container.querySelector(
          '[data-mermaid-action="export-xstate"]',
        ) as HTMLElement
      ).click();
    });

    const modal = container.querySelector("[data-xstate-modal]");
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('"initial"');
    expect(modal?.textContent).toContain('"GO"');
  });

  // W19：编辑图谱 → 应用后回传新源码
  it("点击「编辑图谱」打开编辑器；应用后 onEditCommit 收到新源码", async () => {
    const onEditCommit = vi.fn();
    const renderer: MermaidRenderer = async () => "<svg/>";
    await act(async () => {
      root.render(
        <MermaidViewer
          code="flowchart TD\n  A --> B"
          renderer={renderer}
          onEditCommit={onEditCommit}
        />,
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-mermaid-editor]")).toBeNull();

    await act(async () => {
      (container.querySelector('[data-mermaid-action="edit"]') as HTMLElement).click();
    });
    expect(container.querySelector("[data-mermaid-editor]")).not.toBeNull();

    const textarea = container.querySelector(
      "[data-editor-source]",
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(textarea, "flowchart LR\n  X --> Y");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (container.querySelector('[data-editor-action="apply"]') as HTMLElement).click();
    });

    expect(onEditCommit).toHaveBeenCalledWith("flowchart LR\n  X --> Y");
  });
});
