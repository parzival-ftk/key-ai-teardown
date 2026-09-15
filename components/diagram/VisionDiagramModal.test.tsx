// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { VisionDiagramModal } from "./VisionDiagramModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** /api/parse(diagram) 的成功响应体 */
const OK_RESPONSE = {
  ok: true,
  code: "flowchart TD\n    Client[Client] --> Gateway[API Gateway]",
  diagramType: "flowchart",
  confidenceScore: 90,
  detectedNodesCount: 5,
  source: "model",
};

const FALLBACK_RESPONSE = {
  ok: false,
  code: "flowchart TD\n  %% 未能从图像识别出架构图",
  diagramType: "flowchart",
  confidenceScore: 0,
  detectedNodesCount: 0,
  source: "fallback",
  error: "模型未返回可识别的 mermaid 结构（回复片段：这张图看不清）",
};

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function stubFetch(response: unknown, ok = true): FetchCall[] {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return { ok, status: ok ? 200 : 500, json: async () => response } as Response;
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

const PNG = () => new File(["hello"], "arch.png", { type: "image/png" });

function dispatchDrop(el: Element, file: File) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  act(() => {
    el.dispatchEvent(event);
  });
}

function dispatchPaste(file: File | null, type = "image/png") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { items: [{ type, getAsFile: () => file }] },
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

async function flush() {
  // FileReader 的 load 事件是宏任务，必须让出事件循环而不只是 microtask
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("VisionDiagramModal（服务端静态渲染）", () => {
  it("open=false 不渲染", () => {
    expect(
      renderToStaticMarkup(
        <VisionDiagramModal open={false} onClose={() => {}} />,
      ),
    ).toBe("");
  });

  it("open=true 渲染上传区、文件选择与三个动作按钮", () => {
    const html = renderToStaticMarkup(
      <VisionDiagramModal open title="PRD 撰写官 · 流程图" onClose={() => {}} onReplace={() => {}} onOpenInEditor={() => {}} />,
    );
    expect(html).toContain("data-vision-modal");
    expect(html).toContain("data-vision-dropzone");
    expect(html).toContain("data-vision-file-input");
    expect(html).toContain("从截图还原图谱");
    expect(html).toContain("载入编辑器 (Open in Editor)");
    expect(html).toContain("直接替换章节图谱 (Replace Section Diagram)");
    expect(html).toContain("Ctrl+V");
  });
});

describe("VisionDiagramModal 交互（jsdom）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = (props: Partial<Parameters<typeof VisionDiagramModal>[0]> = {}) =>
    act(() =>
      root.render(
        <VisionDiagramModal
          open
          title="PRD 撰写官 · 流程图"
          onClose={() => {}}
          onReplace={() => {}}
          onOpenInEditor={() => {}}
          {...props}
        />,
      ),
    );

  const dropzone = () => container.querySelector("[data-vision-dropzone]") as HTMLElement;
  const replaceBtn = () =>
    container.querySelector('[data-vision-action="replace"]') as HTMLButtonElement;
  const editorBtn = () =>
    container.querySelector('[data-vision-action="editor"]') as HTMLButtonElement;

  it("拖拽图片 → 调用 /api/parse(type=diagram) 并展示识别元数据与代码", async () => {
    const calls = stubFetch(OK_RESPONSE);
    mount();
    dispatchDrop(dropzone(), PNG());
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/parse");
    expect(calls[0].body.type).toBe("diagram");
    expect(String(calls[0].body.dataUrl)).toMatch(/^data:image\/png;base64,/);

    const meta = container.querySelector("[data-vision-meta]");
    expect(meta?.textContent).toContain("检测到 5 个节点");
    expect(meta?.textContent).toContain("置信度 90%");
    expect(container.querySelector("[data-vision-code]")?.textContent).toContain(
      "flowchart TD",
    );
    expect(container.querySelector("[data-vision-preview]")).not.toBeNull();
  });

  it("剪贴板粘贴图片同样触发识别", async () => {
    const calls = stubFetch(OK_RESPONSE);
    mount();
    dispatchPaste(PNG());
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.type).toBe("diagram");
  });

  it("文件选择器同样触发识别", async () => {
    const calls = stubFetch(OK_RESPONSE);
    mount();
    const input = container.querySelector(
      "[data-vision-file-input]",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [PNG()] });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("识别中显示 Progress Spinner", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await pending;
        return { ok: true, status: 200, json: async () => OK_RESPONSE } as Response;
      }),
    );
    mount();
    dispatchDrop(dropzone(), PNG());
    await flush();
    expect(container.querySelector("[data-vision-spinner]")).not.toBeNull();

    await act(async () => {
      release(undefined);
    });
    await flush();
    expect(container.querySelector("[data-vision-spinner]")).toBeNull();
  });

  it("非图片文件 → 本地报错且不发请求", async () => {
    const calls = stubFetch(OK_RESPONSE);
    mount();
    dispatchDrop(dropzone(), new File(["x"], "a.txt", { type: "text/plain" }));
    await flush();
    expect(calls).toHaveLength(0);
    expect(container.querySelector("[data-vision-error]")).not.toBeNull();
  });

  it("安全降级结果 → 展示降级提示并禁用两个动作", async () => {
    // 注意：diagram 通道降级时仍是 HTTP 200，靠 body 的 source 区分（W25 契约）
    stubFetch(FALLBACK_RESPONSE, true);
    mount();
    dispatchDrop(dropzone(), PNG());
    await flush();
    const degraded = container.querySelector("[data-vision-degraded]");
    expect(degraded).not.toBeNull();
    expect(degraded?.textContent).toContain("已安全降级");
    expect(replaceBtn().disabled).toBe(true);
    expect(editorBtn().disabled).toBe(true);
  });

  it("「直接替换章节图谱」回调携带识别代码", async () => {
    stubFetch(OK_RESPONSE);
    const onReplace = vi.fn();
    mount({ onReplace });
    dispatchDrop(dropzone(), PNG());
    await flush();
    expect(replaceBtn().disabled).toBe(false);
    act(() => replaceBtn().click());
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplace.mock.calls[0][0]).toContain("flowchart TD");
  });

  it("「载入编辑器」回调携带识别代码", async () => {
    stubFetch(OK_RESPONSE);
    const onOpenInEditor = vi.fn();
    mount({ onOpenInEditor });
    dispatchDrop(dropzone(), PNG());
    await flush();
    act(() => editorBtn().click());
    expect(onOpenInEditor).toHaveBeenCalledTimes(1);
    expect(onOpenInEditor.mock.calls[0][0]).toContain("flowchart TD");
  });

  it("识别失败（HTTP 非 2xx）→ 报错且不启用动作", async () => {
    stubFetch({}, false);
    mount();
    dispatchDrop(dropzone(), PNG());
    await flush();
    expect(container.querySelector("[data-vision-error]")).not.toBeNull();
    expect(replaceBtn().disabled).toBe(true);
  });
});
