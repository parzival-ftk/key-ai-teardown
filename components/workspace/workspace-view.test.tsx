// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkspaceView } from "./WorkspaceView";
import { EXAMPLE_PROJECT_ID } from "@/lib/components/demo-project";
import { ensureExampleProject, getProject } from "@/lib/components/project-store";
import type { GenerationResult } from "@/lib/image/provider";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESULT: GenerationResult = {
  id: "prompt-1",
  status: "succeeded",
  provider: "comfyui",
  prompt: "a cinematic futuristic city at night",
  seed: 0,
  checkpoint: "sd_xl_base_1.0.safetensors",
  width: 512,
  height: 512,
  steps: 20,
  cfg: 7.5,
  sampler: "euler",
  scheduler: "normal",
  filename: "key_00001_.png",
  mimeType: "image/png",
  bytes: 100,
  artifactPath: ".rivet/artifacts/comfy/key_00001_.png",
  url: "http://127.0.0.1:8188/view?filename=key_00001_.png",
};

const ILLUSTRATION_ID = "n6";

describe("WorkspaceView（产品闭环集成）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    ensureExampleProject(window.localStorage, 1000);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const mount = async (projectId = EXAMPLE_PROJECT_ID) => {
    await act(async () => {
      root.render(<WorkspaceView projectId={projectId} />);
    });
  };

  it("打开示例工作区：组件树 + 画布节点 + 父子连线渲染", async () => {
    await mount();
    expect($("[data-workspace]")).not.toBeNull();
    expect($("[data-workspace-title]").textContent).toBe("落地页示例");
    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(8);
    expect(container.querySelector("[data-component-tree]")).not.toBeNull();
    expect(container.querySelector("[data-component-connections]")).not.toBeNull();
    // 初始未选中 → Inspector 空态
    expect($("[data-inspector-empty]")).not.toBeNull();
  });

  it("从组件树选中组件 → Inspector 显示字段与 Prompt", async () => {
    await mount();
    act(() => $(`[data-tree-node="${ILLUSTRATION_ID}"]`).click());
    expect($('[data-inspector-field="name"]').textContent).toBe("插图");
    expect(($('[data-inspector-prompt]') as HTMLTextAreaElement).value).toContain("cinematic");
    expect($("[data-inspector-empty]")).toBeNull();
  });

  it("找不到项目时显示 missing 视图", async () => {
    await mount("does-not-exist");
    expect($("[data-workspace-missing]")).not.toBeNull();
  });

  it("Generate Visual → 资产回到画布并绑定来源组件、持久化", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: RESULT }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    act(() => $(`[data-tree-node="${ILLUSTRATION_ID}"]`).click());
    await act(async () => {
      $("[data-inspector-generate]").click();
    });

    // 请求打到 /api/generate
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({ method: "POST" }),
    );
    // Inspector 出现资产缩略图
    expect(container.querySelector(`[data-inspector-asset-thumb="${RESULT.id}"]`)).not.toBeNull();
    // 画布出现新图片节点，且与生成前的组件节点数一致 + 1
    expect(container.querySelector(`[data-canvas-node="asset-${RESULT.id}"]`)).not.toBeNull();
    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(9);
    // 资产绑定来源组件并已持久化
    const saved = getProject(window.localStorage, EXAMPLE_PROJECT_ID);
    expect(saved?.assets).toHaveLength(1);
    expect(saved?.assets[0].componentId).toBe(ILLUSTRATION_ID);
    expect(saved?.assets[0].prompt).toContain("cinematic");
  });

  it("Generate 失败时显示结构化错误且不新增节点", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: false, code: "COMFYUI_UNAVAILABLE", error: "连不上 ComfyUI" }),
          { status: 503 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    act(() => $(`[data-tree-node="${ILLUSTRATION_ID}"]`).click());
    await act(async () => {
      $("[data-inspector-generate]").click();
    });

    expect($("[data-inspector-error]").textContent).toContain("COMFYUI_UNAVAILABLE");
    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(8);
  });
});
