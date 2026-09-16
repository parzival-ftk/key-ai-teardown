// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CanvasViewport } from "./CanvasViewport";
import {
  ComfyClient,
  type ComfyClientEvents,
  type ComfyWebSocketLike,
} from "@/lib/canvas/comfy-bridge";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * W31 集成：画布 ↔ ComfyUI 桥接。
 *
 * 唯一被替身的是**网络传输**（WebSocket / fetch）——那是环境边界。
 * ComfyClient、buildInpaintWorkflow、视口数学、图层操作全都是真货。
 */

class FakeSocket implements ComfyWebSocketLike {
  readyState = 0;
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send() {}
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  die() {
    this.onclose?.({});
  }
}

const IMAGE_NODE = {
  id: "img-1",
  type: "image" as const,
  x: 100,
  y: 60,
  width: 256,
  height: 256,
  zIndex: 1,
  label: "底图",
  src: "https://example.com/base.png",
};

/** 假传输：上传返回递增的文件名，/prompt 返回固定 prompt_id */
function makeTransport() {
  const sockets: FakeSocket[] = [];
  const calls: { url: string; init?: RequestInit }[] = [];
  let uploads = 0;

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/upload/image")) {
      uploads += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: `uploaded-${uploads}.png`, subfolder: "", type: "input" }),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ prompt_id: "p1" }) } as Response;
  }) as unknown as typeof fetch;

  const ports = {
    createMask: vi.fn(async () => new Blob(["mask"], { type: "image/png" })),
    loadImageBlob: vi.fn(async () => new Blob(["img"], { type: "image/png" })),
    createClient: (config: { baseUrl: string }, events: ComfyClientEvents) =>
      new ComfyClient(
        {
          ...config,
          fetchImpl,
          maxReconnects: 0,
          webSocketFactory: (url) => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
          },
        },
        events,
      ),
  };

  return { ports, sockets, calls, fetchImpl };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => {
  await act(async () => {
    await sleep(0);
    await sleep(0);
  });
};

describe("CanvasViewport ↔ ComfyUI（集成）", () => {
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

  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const mount = (ports: ReturnType<typeof makeTransport>["ports"]) =>
    act(() =>
      root.render(
        <CanvasViewport
          initialNodes={[IMAGE_NODE]}
          inpaintPorts={ports}
          comfyServerUrl="http://127.0.0.1:8188"
        />,
      ),
    );

  const typePrompt = (value: string) => {
    const input = $("[data-canvas-inpaint-prompt]");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("选节点 → 输入 Prompt → 提交：上传两次、提交 workflow、进度、结果落回原坐标", async () => {
    const { ports, sockets, calls } = makeTransport();
    mount(ports);

    // 未选中时没有工具栏
    expect(container.querySelector("[data-canvas-inpaint-bar]")).toBeNull();

    act(() => $('[data-canvas-layer="img-1"]').click());
    expect($("[data-canvas-inpaint-bar]")).not.toBeNull();
    // 未填 Prompt 时按钮禁用
    expect(($("[data-canvas-inpaint-submit]") as HTMLButtonElement).disabled).toBe(true);

    typePrompt("把这里换成一只猫");
    expect(($("[data-canvas-inpaint-submit]") as HTMLButtonElement).disabled).toBe(false);

    act(() => $("[data-canvas-inpaint-submit]").click());
    await flush();

    // 建立连接
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("ws://127.0.0.1:8188/ws?clientId=");
    act(() => sockets[0].open());
    await flush();

    // 图与遮罩都取自真实节点数据
    expect(ports.loadImageBlob).toHaveBeenCalledWith(IMAGE_NODE.src);
    expect(ports.createMask).toHaveBeenCalledWith({ width: 256, height: 256 });

    // 两次上传（原图 + 遮罩）
    const uploads = calls.filter((c) => c.url.endsWith("/upload/image"));
    expect(uploads).toHaveLength(2);

    // workflow 里 LoadImage 用的是**上传返回的文件名**，提示词进了 CLIPTextEncode
    const promptCall = calls.find((c) => c.url.endsWith("/prompt"));
    expect(promptCall).toBeTruthy();
    const workflow = JSON.parse(String(promptCall?.init?.body)).prompt;
    expect(workflow["1"].inputs.image).toBe("uploaded-1.png");
    expect(workflow["2"].inputs.image).toBe("uploaded-2.png");
    expect(workflow["5"].inputs.text).toBe("把这里换成一只猫");

    // 进度实时反映
    act(() => sockets[0].emit({ type: "progress", data: { value: 5, max: 10 } }));
    await flush();
    expect($("[data-canvas-inpaint-progress]").textContent).toContain("50%");

    // 结果落回**框选的原始坐标与尺寸**
    act(() =>
      sockets[0].emit({
        type: "executed",
        data: { node: "9", output: { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
      }),
    );
    await flush();

    const created = container.querySelector('[data-canvas-node="image-2"]') as HTMLElement;
    expect(created).not.toBeNull();
    expect(created.style.left).toBe("100px");
    expect(created.style.top).toBe("60px");
    expect(created.style.width).toBe("256px");
    expect(created.style.height).toBe("256px");
    // 生成结束后按钮恢复可用、进度清除
    expect(container.querySelector("[data-canvas-inpaint-progress]")).toBeNull();
    expect(($("[data-canvas-inpaint-submit]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("后端不可达 → 显示错误、状态复位，且不抛未捕获异常", async () => {
    const { ports, sockets } = makeTransport();
    mount(ports);
    act(() => $('[data-canvas-layer="img-1"]').click());
    typePrompt("重绘");

    act(() => $("[data-canvas-inpaint-submit]").click());
    await flush();
    act(() => sockets[0].die()); // 连不上
    await flush();

    const error = container.querySelector("[data-canvas-inpaint-error]");
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain("连接");
    // 状态复位：还在生成中就说不过去了
    expect(($("[data-canvas-inpaint-submit]") as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(1);
  });

  it("非图片节点不能重绘：按钮禁用并给出原因", async () => {
    const { ports } = makeTransport();
    act(() =>
      root.render(
        <CanvasViewport
          initialNodes={[
            { id: "frame-1", type: "frame", x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
          ]}
          inpaintPorts={ports}
          comfyServerUrl="http://127.0.0.1:8188"
        />,
      ),
    );
    act(() => $('[data-canvas-layer="frame-1"]').click());
    typePrompt("试试");
    expect(($("[data-canvas-inpaint-submit]") as HTMLButtonElement).disabled).toBe(true);
    expect($("[data-canvas-inpaint-bar]").textContent).toContain("图片");
  });

  it("粘贴图片 → 落成 image 节点（inpaint 的必需前提：画布上得先有图）", async () => {
    const { ports } = makeTransport();
    act(() =>
      root.render(<CanvasViewport inpaintPorts={ports} comfyServerUrl="http://127.0.0.1:8188" />),
    );
    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(0);

    const file = new File(["png-bytes"], "shot.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    act(() => {
      window.dispatchEvent(event);
    });
    await flush();

    const nodes = container.querySelectorAll("[data-canvas-node]");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].getAttribute("data-canvas-node")).toBe("image-1");

    // 选中后即可重绘（按钮不再因「没有图片」禁用）
    act(() => $('[data-canvas-layer="image-1"]').click());
    typePrompt("重绘");
    expect(($("[data-canvas-inpaint-submit]") as HTMLButtonElement).disabled).toBe(false);
  });
});
