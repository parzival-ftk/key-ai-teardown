// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })),
  },
}));

import { MermaidEditorModal } from "./MermaidEditorModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * W27：编辑器工具栏的「语法校对 (Sanitize)」与「一键整理布局」。
 */
describe("MermaidEditorModal W27：语法校对与布局整理", () => {
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
    vi.restoreAllMocks();
  });

  const mount = (code: string) =>
    act(() =>
      root.render(
        <MermaidEditorModal
          code={code}
          kind="flowchart"
          onClose={() => {}}
          onApply={() => {}}
        />,
      ),
    );
  const source = () =>
    container.querySelector("[data-editor-source]") as HTMLTextAreaElement;
  const click = (action: string) =>
    act(() =>
      (
        container.querySelector(
          `[data-editor-action="${action}"]`,
        ) as HTMLElement
      ).click(),
    );

  it("工具栏提供「语法校对」与「一键整理布局」", () => {
    mount("flowchart TD\n  A --> B");
    expect(container.querySelector('[data-editor-action="sanitize"]')).not.toBeNull();
    expect(container.querySelector('[data-editor-action="optimize"]')).not.toBeNull();
  });

  it("「语法校对 (Sanitize)」修补畸形代码并提示修复处数", () => {
    mount("Client --> 服务\nGateway -->");
    click("sanitize");

    expect(source().value.startsWith("flowchart TD")).toBe(true);
    expect(source().value).toContain("N1[服务]");
    expect(source().value.trimEnd().endsWith("-->")).toBe(false);

    const note = container.querySelector("[data-editor-sanitize-note]");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("已自动修复 3 处语法");
  });

  it("干净代码 → 提示「语法已规范，无需修补」且源码不变", () => {
    mount("flowchart TD\n  A --> B");
    click("sanitize");
    expect(source().value).toBe("flowchart TD\n  A --> B");
    expect(
      container.querySelector("[data-editor-sanitize-note]")?.textContent,
    ).toContain("无需修补");
  });

  it("「一键整理布局」规范化缩进与箭头间距", () => {
    mount("flowchart TD\nA-->B\nB   -->   C");
    click("optimize");
    expect(source().value).toBe("flowchart TD\n  A --> B\n  B --> C");
  });

  it("整理布局后再点语法校对 → 判定为无需修补（两者协同、不互相打架）", () => {
    mount("flowchart TD\nA-.->B\nB==>C");
    click("sanitize");
    const afterSanitize = source().value;
    click("optimize");
    const afterOptimize = source().value;
    expect(afterOptimize).toContain("A -.-> B");
    expect(afterOptimize).toContain("B ==> C");

    click("sanitize");
    expect(source().value).toBe(afterOptimize);
    expect(afterSanitize).not.toBe("");
  });
});
