// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  XStateExportModal,
  HighlightedCode,
  type CodeDownloader,
} from "./XStateExportModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIAGRAM = `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading : SUBMIT
  Loading --> Success : DONE
  Success --> [*]`;

const noop = () => {};

describe("HighlightedCode（纯渲染）", () => {
  it("token 以 span 呈现且不注入 HTML", () => {
    const html = renderToStaticMarkup(
      <HighlightedCode code={'const a = "<img src=x>";'} language="ts" />,
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain('data-token="keyword"');
    expect(html).toContain('data-token="string"');
  });
});

describe("XStateExportModal（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(
    <XStateExportModal code={DIAGRAM} onClose={noop} />,
  );

  it("渲染为对话框，含 JSON / TypeScript 两个标签页", () => {
    expect(html).toContain("data-xstate-modal");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("导出 XState");
    expect(html).toContain('data-xstate-tab="json"');
    expect(html).toContain('data-xstate-tab="ts"');
  });

  it("默认展示 JSON 机器配置（含 id / initial / states 与高亮 token）", () => {
    expect(html).toContain('data-xstate-language="json"');
    expect(html).toContain("Idle");
    expect(html).toContain('data-token="property"'); // JSON 键
  });

  it("提供复制与下载两个动作", () => {
    expect(html).toContain('data-xstate-action="copy"');
    expect(html).toContain('data-xstate-action="download"');
    expect(html).toContain("machine.json");
  });

  it("非法输入时展示诊断信息", () => {
    const bad = renderToStaticMarkup(<XStateExportModal code="" onClose={noop} />);
    expect(bad).toContain("data-xstate-diagnostics");
  });
});

describe("XStateExportModal（jsdom 挂载与交互）", () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const mount = (ui: React.ReactElement) => act(() => root.render(ui));
  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
  const codeText = () => $("[data-xstate-code]").textContent ?? "";

  it("挂载后出现在 DOM 中", () => {
    mount(<XStateExportModal code={DIAGRAM} onClose={noop} />);
    expect(container.querySelector("[data-xstate-modal]")).not.toBeNull();
    expect(codeText()).toContain('"initial"');
  });

  it("切换标签页 → 预览变为 TypeScript 源码", () => {
    mount(<XStateExportModal code={DIAGRAM} onClose={noop} />);
    expect(codeText()).not.toContain("createMachine");
    act(() => $('[data-xstate-tab="ts"]').click());
    expect(codeText()).toContain('import { createMachine } from "xstate"');
    expect($('[data-xstate-tab="ts"]').getAttribute("aria-selected")).toBe("true");
  });

  it("点击『一键复制』→ 剪贴板收到当前标签页的源码，按钮变『已复制』", async () => {
    mount(<XStateExportModal code={DIAGRAM} onClose={noop} />);
    const jsonText = codeText();
    await act(async () => {
      $('[data-xstate-action="copy"]').click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(jsonText);
    expect($('[data-xstate-action="copy"]').textContent).toBe("已复制");
  });

  it("剪贴板不可用时静默降级，不抛错", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    mount(<XStateExportModal code={DIAGRAM} onClose={noop} />);
    await act(async () => {
      $('[data-xstate-action="copy"]').click();
      await Promise.resolve();
    });
    expect($('[data-xstate-action="copy"]').textContent).toBe("一键复制");
  });

  it("下载文件名随标签页变化（.json / .ts）", () => {
    const downloader = vi.fn<CodeDownloader>();
    mount(
      <XStateExportModal code={DIAGRAM} onClose={noop} downloader={downloader} />,
    );
    act(() => $('[data-xstate-action="download"]').click());
    expect(downloader).toHaveBeenLastCalledWith("machine.json", expect.any(String));

    act(() => $('[data-xstate-tab="ts"]').click());
    act(() => $('[data-xstate-action="download"]').click());
    const [name, text] = downloader.mock.calls[1];
    expect(name).toBe("machine.ts");
    expect(text).toContain("createMachine");
  });

  it("自定义 baseName 影响文件名", () => {
    const downloader = vi.fn<CodeDownloader>();
    mount(
      <XStateExportModal
        code={DIAGRAM}
        onClose={noop}
        baseName="orderFlow"
        downloader={downloader}
      />,
    );
    act(() => $('[data-xstate-action="download"]').click());
    expect(downloader).toHaveBeenLastCalledWith("orderFlow.json", expect.any(String));
  });

  it("点击关闭按钮 / 遮罩 → 触发 onClose；点击面板内部不关闭", () => {
    const onClose = vi.fn();
    mount(<XStateExportModal code={DIAGRAM} onClose={onClose} />);
    act(() => $("[data-xstate-preview]").click());
    expect(onClose).not.toHaveBeenCalled();
    act(() => $('[data-xstate-action="close"]').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => $("[data-xstate-modal]").click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
