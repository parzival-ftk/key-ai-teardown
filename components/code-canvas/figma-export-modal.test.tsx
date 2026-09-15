// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { FigmaExportModal, type FigmaJsonDownloader } from "./FigmaExportModal";
import { figmaDocumentToJson, htmlToFigmaDocument } from "@/lib/export/figma-exporter";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 用真实引擎产出一份 Figma JSON，保证弹窗展示的是真实结构而非占位串 */
const SAMPLE_JSON = figmaDocumentToJson(
  htmlToFigmaDocument('<div class="bg-blue-500 p-4"><p class="text-white">Hi</p></div>'),
);

const noop = () => {};

describe("FigmaExportModal（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(<FigmaExportModal json={SAMPLE_JSON} onClose={noop} />);

  it("渲染为对话框，含 JSON 结构与提示文案", () => {
    expect(html).toContain("data-figma-modal");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("导出 Figma JSON");
    expect(html).toContain("CANVAS");
    expect(html).toContain("JSON to Figma");
  });

  it("提供复制与下载两个动作", () => {
    expect(html).toContain('data-figma-action="copy"');
    expect(html).toContain("一键复制 JSON");
    expect(html).toContain('data-figma-action="download"');
    expect(html).toContain("下载 .json 文件");
  });

  it("JSON 被作为文本转义渲染（不注入 HTML）", () => {
    const html2 = renderToStaticMarkup(
      <FigmaExportModal json={'{"a":"<img src=x>"}'} onClose={noop} />,
    );
    expect(html2).toContain("&lt;img");
    expect(html2).not.toContain("<img src=x>");
  });
});

describe("FigmaExportModal（jsdom 挂载与交互）", () => {
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

  const mount = (ui: React.ReactElement) => {
    act(() => root.render(ui));
  };

  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;

  it("挂载后出现在 DOM 中", () => {
    mount(<FigmaExportModal json={SAMPLE_JSON} onClose={noop} />);
    expect(container.querySelector("[data-figma-modal]")).not.toBeNull();
    expect($("[data-figma-json]").textContent).toContain("DOCUMENT");
  });

  it("点击『一键复制 JSON』→ 剪贴板收到该 JSON，按钮变『已复制』", async () => {
    mount(<FigmaExportModal json={SAMPLE_JSON} onClose={noop} />);
    await act(async () => {
      $('[data-figma-action="copy"]').click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(SAMPLE_JSON);
    expect($('[data-figma-action="copy"]').textContent).toBe("已复制");
  });

  it("剪贴板不可用时静默降级，不抛错", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    mount(<FigmaExportModal json={SAMPLE_JSON} onClose={noop} />);
    await act(async () => {
      $('[data-figma-action="copy"]').click();
      await Promise.resolve();
    });
    // 未变为「已复制」即视为降级成功（未崩溃）
    expect($('[data-figma-action="copy"]').textContent).toBe("一键复制 JSON");
  });

  it("点击『下载 .json 文件』→ 以给定文件名与 JSON 触发下载", () => {
    const downloader = vi.fn<FigmaJsonDownloader>();
    mount(
      <FigmaExportModal
        json={SAMPLE_JSON}
        onClose={noop}
        filename="notion-figma.json"
        downloader={downloader}
      />,
    );
    act(() => $('[data-figma-action="download"]').click());
    expect(downloader).toHaveBeenCalledWith("notion-figma.json", SAMPLE_JSON);
  });

  it("点击关闭按钮 → 触发 onClose", () => {
    const onClose = vi.fn();
    mount(<FigmaExportModal json={SAMPLE_JSON} onClose={onClose} />);
    act(() => $('[data-figma-action="close"]').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭；点击面板内部不关闭", () => {
    const onClose = vi.fn();
    mount(<FigmaExportModal json={SAMPLE_JSON} onClose={onClose} />);
    // 面板内部（JSON 区）点击不应关闭
    act(() => $("[data-figma-json]").click());
    expect(onClose).not.toHaveBeenCalled();
    // 遮罩点击关闭
    act(() => $("[data-figma-modal]").click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
