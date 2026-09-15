// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceExtendPanel } from "./ResourceExtendPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ResourceExtendPanel（Master Prompt 挂载点）", () => {
  const html = renderToStaticMarkup(
    <ResourceExtendPanel existingIds={["coolors", "mobbin"]} />,
  );

  it("静态渲染出扩充流程与完整 Master Prompt", () => {
    expect(html).toContain("data-resource-extend");
    expect(html).toContain("data-resource-prompt");
    expect(html).toContain("复制 Master Prompt");
    // prompt 正文（含已收录 id 小节）确实被渲染出来
    expect(html).toContain("【待处理的数据源 / 网址】");
    expect(html).toContain("coolors, mobbin");
  });
});

describe("ResourceExtendPanel 交互（jsdom）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("点「复制 Master Prompt」写入剪贴板并短暂提示", async () => {
    act(() => root.render(<ResourceExtendPanel existingIds={["coolors"]} />));
    const button = container.querySelector(
      "[data-resource-copy-prompt]",
    ) as HTMLButtonElement;

    await act(async () => {
      button.click();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const written = (navigator.clipboard.writeText as unknown as { mock: { calls: string[][] } })
      .mock.calls[0][0];
    expect(written).toContain("coolors");
    expect(container.querySelector("[data-resource-copy-prompt]")?.textContent).toBe(
      "已复制",
    );
  });
});
