// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MermaidEditorModal } from "./MermaidEditorModal";
import type { MermaidRenderer } from "@/lib/diagram/render-mermaid";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FLOW = "flowchart TD\n  A[开始] --> B[结束]";
const STATE = "stateDiagram-v2\n  [*] --> 空闲\n  空闲 --> 运行";
const noop = () => {};
const okRenderer: MermaidRenderer = async () => "<svg data-stub/>";

describe("MermaidEditorModal（服务端静态渲染）", () => {
  it("渲染源码编辑区与预览区", () => {
    const html = renderToStaticMarkup(
      <MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} />,
    );
    expect(html).toContain("data-mermaid-editor");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("data-editor-source");
    expect(html).toContain("data-editor-preview");
    expect(html).toContain("A[开始]");
  });

  it("按图形类型给出对应的快捷操作", () => {
    const flow = renderToStaticMarkup(
      <MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} />,
    );
    expect(flow).toContain('data-editor-action="add-node"');
    expect(flow).not.toContain('data-editor-action="add-state"');

    const state = renderToStaticMarkup(
      <MermaidEditorModal code={STATE} kind="state" onClose={noop} />,
    );
    expect(state).toContain('data-editor-action="add-state"');
    expect(state).not.toContain('data-editor-action="add-node"');
  });

  it("两个动作按钮恒在（应用 / 还原），格式化恒在", () => {
    const html = renderToStaticMarkup(
      <MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} />,
    );
    expect(html).toContain('data-editor-action="apply"');
    expect(html).toContain("应用修改并同步至 PRD");
    expect(html).toContain('data-editor-action="revert"');
    expect(html).toContain("还原为 AI 初始图谱");
    expect(html).toContain('data-editor-action="format"');
  });

  it("未提供 onApply 时「应用」「还原」被禁用（避免死按钮）", () => {
    const html = renderToStaticMarkup(
      <MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} />,
    );
    expect(html).toMatch(/data-editor-action="apply"[^>]*disabled/);
    expect(html).toMatch(/data-editor-action="revert"[^>]*disabled/);
  });
});

describe("MermaidEditorModal（jsdom 编辑与同步）", () => {
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

  /** React 受控输入需要走原生 setter 再派发 input，否则 onChange 不触发 */
  const setSourceValue = (value: string) => {
    const el = container.querySelector("[data-editor-source]") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const mount = async (ui: React.ReactElement) => {
    await act(async () => {
      root.render(ui);
      await Promise.resolve();
    });
  };

  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
  const sourceValue = () =>
    (container.querySelector("[data-editor-source]") as HTMLTextAreaElement).value;

  it("编辑源码后草稿更新并出现「未同步」提示", async () => {
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={noop} renderer={okRenderer} />);
    expect(container.querySelector("[data-editor-dirty]")).toBeNull();
    await act(async () => setSourceValue("flowchart LR\n  X --> Y"));
    expect(sourceValue()).toBe("flowchart LR\n  X --> Y");
    expect(container.querySelector("[data-editor-dirty]")).not.toBeNull();
  });

  it("「+ 添加节点」追加节点并连边", async () => {
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={noop} renderer={okRenderer} />);
    await act(async () => $('[data-editor-action="add-node"]').click());
    expect(sourceValue()).toContain("N1[新节点]");
    expect(sourceValue()).toContain("A --> N1");
  });

  it("「+ 添加状态」追加状态并连转换", async () => {
    await mount(<MermaidEditorModal code={STATE} kind="state" onClose={noop} onApply={noop} renderer={okRenderer} />);
    await act(async () => $('[data-editor-action="add-state"]').click());
    expect(sourceValue()).toContain("空闲 --> 新状态1");
  });

  it("「格式化代码」规范化缩进与空行", async () => {
    await mount(
      <MermaidEditorModal code={"flowchart TD\n\n\n      A-->B\n\n"} kind="flowchart" onClose={noop} onApply={noop} renderer={okRenderer} />,
    );
    await act(async () => $('[data-editor-action="format"]').click());
    expect(sourceValue()).toBe("flowchart TD\n\n  A-->B");
  });

  it("语法错误 → 诊断列出且「应用」禁用", async () => {
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={noop} renderer={okRenderer} />);
    await act(async () => setSourceValue("A --> B")); // 缺图形声明
    const list = container.querySelector("[data-editor-diagnostics]");
    expect(list?.textContent).toContain("缺少图形声明");
    expect(($('[data-editor-action="apply"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("合法源码 → 提示未发现问题且「应用」可用", async () => {
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={noop} renderer={okRenderer} />);
    expect(container.querySelector("[data-editor-diagnostics-ok]")).not.toBeNull();
    expect(($('[data-editor-action="apply"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("源码被清空 → 无法应用", async () => {
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={noop} renderer={okRenderer} />);
    await act(async () => setSourceValue("   "));
    expect(($('[data-editor-action="apply"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("「应用修改并同步至 PRD」→ onApply 收到当前草稿", async () => {
    const onApply = vi.fn();
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={onApply} renderer={okRenderer} />);
    await act(async () => setSourceValue("flowchart LR\n  X --> Y"));
    await act(async () => $('[data-editor-action="apply"]').click());
    expect(onApply).toHaveBeenCalledWith("flowchart LR\n  X --> Y");
    expect($('[data-editor-action="apply"]').textContent).toBe("已同步至 PRD");
  });

  it("「还原为 AI 初始图谱」→ 编辑区回到初版并同步回 PRD", async () => {
    const onApply = vi.fn();
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={onApply} renderer={okRenderer} />);
    await act(async () => setSourceValue("flowchart LR\n  X --> Y"));
    await act(async () => $('[data-editor-action="revert"]').click());
    expect(sourceValue()).toBe(FLOW);
    expect(onApply).toHaveBeenCalledWith(FLOW);
    expect(container.querySelector("[data-editor-dirty]")).toBeNull();
  });

  it("关闭：按钮与遮罩都触发 onClose，面板内点击不触发", async () => {
    const onClose = vi.fn();
    await mount(<MermaidEditorModal code={FLOW} kind="flowchart" onClose={onClose} onApply={noop} renderer={okRenderer} />);
    await act(async () => $("[data-editor-preview]").click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => $('[data-editor-action="close"]').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => $("[data-mermaid-editor]").click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("MermaidEditorModal（实时预览）", () => {
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

  const mount = async (ui: React.ReactElement) => {
    await act(async () => {
      root.render(ui);
      await Promise.resolve();
    });
  };

  it("渲染成功 → 预览区出现 SVG", async () => {
    await mount(
      <MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={noop} renderer={okRenderer} />,
    );
    const preview = container.querySelector("[data-editor-preview]");
    expect(preview?.querySelector("[data-editor-preview-status]")?.getAttribute("data-editor-preview-status")).toBe("ok");
    expect(preview?.querySelector("svg")).not.toBeNull();
  });

  it("渲染失败 → 预览区给出「图谱不合法」提示", async () => {
    const failing: MermaidRenderer = async () => {
      throw new Error("Parse error on line 1");
    };
    await mount(
      <MermaidEditorModal code={FLOW} kind="flowchart" onClose={noop} onApply={noop} renderer={failing} />,
    );
    const preview = container.querySelector("[data-editor-preview]");
    expect(preview?.textContent).toContain("图谱不合法");
    expect(preview?.textContent).toContain("Parse error on line 1");
  });
});
