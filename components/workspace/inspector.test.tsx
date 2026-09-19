// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Inspector } from "./Inspector";
import { createExampleProject } from "@/lib/components/demo-project";
import type { GeneratedAsset } from "@/lib/components/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tree = createExampleProject(1000).tree;
const illustrationId = Object.values(tree.nodes).find((n) => n.name === "插图")!.id;

const ASSET: GeneratedAsset = {
  id: "a1",
  componentId: illustrationId,
  provider: "comfyui",
  prompt: "cinematic city",
  artifactPath: "/tmp/a.png",
  url: "http://127.0.0.1:8188/view?filename=a.png",
  width: 512,
  height: 512,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Inspector", () => {
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

  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;

  it("未选中时显示空态", () => {
    act(() =>
      root.render(<Inspector tree={tree} componentId={null} assets={[]} generating={false} canGenerate={false} />),
    );
    expect($("[data-inspector-empty]")).not.toBeNull();
  });

  it("选中组件时展示字段与面包屑", () => {
    act(() =>
      root.render(
        <Inspector
          tree={tree}
          componentId={illustrationId}
          assets={[]}
          generating={false}
          canGenerate
        />,
      ),
    );
    expect($('[data-inspector-field="name"]').textContent).toBe("插图");
    expect($('[data-inspector-field="type"]').textContent).toBe("组件");
    expect($('[data-inspector-field="role"]').textContent).toBe("主视觉插图");
    expect($("[data-inspector-breadcrumb]").textContent).toContain("落地页 / 主视觉 / 插图");
    expect(($('[data-inspector-prompt]') as HTMLTextAreaElement).value).toContain("cinematic");
  });

  it("编辑 Prompt 回传组件 id 与新文本", () => {
    const onPromptChange = vi.fn();
    act(() =>
      root.render(
        <Inspector
          tree={tree}
          componentId={illustrationId}
          assets={[]}
          generating={false}
          canGenerate
          onPromptChange={onPromptChange}
        />,
      ),
    );
    const textarea = $("[data-inspector-prompt]") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(textarea, "new prompt");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onPromptChange).toHaveBeenCalledWith(illustrationId, "new prompt");
  });

  it("Copy Prompt 与 Generate 按钮各自回调", () => {
    const onCopyPrompt = vi.fn();
    const onGenerate = vi.fn();
    act(() =>
      root.render(
        <Inspector
          tree={tree}
          componentId={illustrationId}
          assets={[]}
          generating={false}
          canGenerate
          onCopyPrompt={onCopyPrompt}
          onGenerate={onGenerate}
        />,
      ),
    );
    act(() => $("[data-inspector-copy-prompt]").click());
    expect(onCopyPrompt).toHaveBeenCalledWith(
      Object.values(tree.nodes).find((n) => n.id === illustrationId)!.prompt,
    );
    act(() => $("[data-inspector-generate]").click());
    expect(onGenerate).toHaveBeenCalledWith(illustrationId);
  });

  it("canGenerate=false 时禁用生成按钮", () => {
    act(() =>
      root.render(
        <Inspector tree={tree} componentId={illustrationId} assets={[]} generating={false} canGenerate={false} />,
      ),
    );
    expect(($("[data-inspector-generate]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("生成中显示状态文案并禁用按钮", () => {
    act(() =>
      root.render(
        <Inspector
          tree={tree}
          componentId={illustrationId}
          assets={[]}
          generating
          generatingLabel="Generating…"
          canGenerate
        />,
      ),
    );
    expect($("[data-inspector-generating]").textContent).toContain("Generating…");
    expect(($("[data-inspector-generate]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("失败时展示结构化错误", () => {
    act(() =>
      root.render(
        <Inspector
          tree={tree}
          componentId={illustrationId}
          assets={[]}
          generating={false}
          canGenerate
          error="COMFYUI_UNAVAILABLE: 连不上 ComfyUI"
        />,
      ),
    );
    expect($("[data-inspector-error]").textContent).toContain("COMFYUI_UNAVAILABLE");
  });

  it("有资产时渲染缩略图与三个动作", () => {
    const onRegenerate = vi.fn();
    const onOpenAsset = vi.fn();
    const onUseAsset = vi.fn();
    act(() =>
      root.render(
        <Inspector
          tree={tree}
          componentId={illustrationId}
          assets={[ASSET]}
          generating={false}
          canGenerate
          onRegenerate={onRegenerate}
          onOpenAsset={onOpenAsset}
          onUseAsset={onUseAsset}
        />,
      ),
    );
    expect($(`[data-inspector-asset-thumb="${ASSET.id}"]`)).not.toBeNull();
    act(() => $("[data-inspector-regenerate]").click());
    expect(onRegenerate).toHaveBeenCalledWith(illustrationId);
    act(() => $("[data-inspector-open-asset]").click());
    expect(onOpenAsset).toHaveBeenCalledWith(ASSET);
    act(() => $("[data-inspector-use-asset]").click());
    expect(onUseAsset).toHaveBeenCalledWith(ASSET);
  });

  it("DEMO 分析来源显示标记", () => {
    act(() =>
      root.render(
        <Inspector
          tree={tree}
          componentId={illustrationId}
          assets={[]}
          generating={false}
          canGenerate
          analysisSource="demo"
        />,
      ),
    );
    expect($("[data-inspector-demo-badge]")).not.toBeNull();
  });
});
