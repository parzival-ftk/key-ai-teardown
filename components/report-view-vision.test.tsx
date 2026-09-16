// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/** 避免在 jsdom 里跑真实 mermaid（重且依赖浏览器 API） */
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })),
  },
}));

import { ReportView, type ReportData } from "./report-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 本条用例挂载 W19 编辑器，而编辑器内含动态 `import("mermaid")` 的预览；
 * 全量并行跑（100 文件）时模块转换与 GC 争用会让它远超默认的 5s 用例超时。
 * 放宽的是**时间预算**，断言内容一字未动 —— 行为真坏了仍会超时抛出原始断言错误。
 */
vi.setConfig({ testTimeout: 20_000 });

/**
 * W26 集成：报告页「从截图还原图谱」全链路 ——
 * 图谱工具栏入口 → 截图识别 Modal → 直接替换 PRD 围栏 / 交棒 W19 编辑器后写回。
 */

const PRD_TEXT = [
  "## 用户故事",
  "",
  "- 一键模板开始 [C1]",
  "",
  "```mermaid",
  "flowchart TD",
  "  A[进入] --> B[选模板]",
  "```",
].join("\n");

const DATA: ReportData = {
  name: "Notion",
  sections: [
    { agentId: "prd", name: "PRD 撰写官", status: "done", output: PRD_TEXT },
  ],
};

const RECOGNIZED = "flowchart TD\n    Client[Client] --> Gateway[API Gateway]";

const PARSE_RESPONSE = {
  ok: true,
  code: RECOGNIZED,
  diagramType: "flowchart",
  confidenceScore: 90,
  detectedNodesCount: 5,
  source: "model",
};

const PNG = () => new File(["hello"], "arch.png", { type: "image/png" });

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("报告页 W26：从截图还原图谱", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Element.prototype.scrollIntoView = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => PARSE_RESPONSE,
      })),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = () =>
    act(() => root.render(<ReportView id="t" initialData={DATA} />));
  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
  const viewerSource = () =>
    container.querySelector("[data-mermaid-source]")?.textContent ?? "";

  /**
   * 有界等待（HANDOFF 坑 #15 的方子）：跨越「子→父→子」重渲染链路的断言，
   * 在全量并行跑时会被调度抖动拖慢；轮询到条件成立即返回，**行为真坏了仍超时抛原断言错误**。
   */
  const waitFor = async (assert: () => void, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        assert();
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
    }
  };

  /** 打开识别 Modal 并投入一张图片，等待识别结果 */
  const extract = async () => {
    act(() => $('[data-mermaid-action="extract-from-image"]').click());
    const zone = $("[data-vision-dropzone]");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [PNG()] } });
    act(() => {
      zone.dispatchEvent(drop);
    });
    await flush();
  };

  it("图谱工具栏提供「从截图还原图谱」入口", () => {
    mount();
    expect($("[data-mermaid-action=\"extract-from-image\"]")).not.toBeNull();
  });

  it("识别后「直接替换章节图谱」→ PRD 围栏被写回识别代码", async () => {
    mount();
    await extract();
    expect($("[data-vision-modal]")).not.toBeNull();
    expect($("[data-vision-meta]").textContent).toContain("检测到 5 个节点");

    act(() => $('[data-vision-action="replace"]').click());

    expect(container.querySelector("[data-vision-modal]")).toBeNull();
    expect(viewerSource()).toContain("Gateway[API Gateway]");
    // 不变量：追溯锚点未被破坏
    expect(container.querySelector('[data-prd-ref="C1"]')).not.toBeNull();
  });

  it("识别后「载入编辑器」→ W19 编辑器载入识别代码，应用后写回 PRD", async () => {
    mount();
    await extract();

    act(() => $('[data-vision-action="editor"]').click());
    expect(container.querySelector("[data-vision-modal]")).toBeNull();

    const editor = $("[data-mermaid-editor]");
    expect(editor).not.toBeNull();
    const source = container.querySelector(
      "[data-editor-source]",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(source.value).toContain("Gateway[API Gateway]"));

    await act(async () => {
      (container.querySelector('[data-editor-action="apply"]') as HTMLElement).click();
    });
    await waitFor(() =>
      expect(viewerSource()).toContain("Gateway[API Gateway]"),
    );
    expect(container.querySelector('[data-prd-ref="C1"]')).not.toBeNull();
  });
});
