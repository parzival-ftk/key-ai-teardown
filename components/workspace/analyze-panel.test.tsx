// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnalyzePanel } from "./AnalyzePanel";
import { INITIAL_ANALYZE_STATE, analyzeReducer } from "@/lib/components/analysis/status";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("AnalyzePanel", () => {
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
  const render = (props: Partial<Parameters<typeof AnalyzePanel>[0]> = {}) =>
    act(() =>
      root.render(
        <AnalyzePanel
          state={INITIAL_ANALYZE_STATE}
          onSelectFile={vi.fn()}
          onAnalyze={vi.fn()}
          onReset={vi.fn()}
          {...props}
        />,
      ),
    );

  it("空态：Analyze 按钮禁用，显示提示", () => {
    render();
    expect(($("[data-analyze-run]") as HTMLButtonElement).disabled).toBe(true);
    expect($("[data-analyze-status]").getAttribute("data-status")).toBe("idle");
  });

  it("选择文件触发 onSelectFile", () => {
    const onSelectFile = vi.fn();
    render({ onSelectFile });
    const input = $("[data-analyze-input]") as HTMLInputElement;
    const file = new File(["x"], "shot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onSelectFile).toHaveBeenCalledWith(file);
  });

  it("已选图后可 Analyze，点击触发 onAnalyze；预览可见", () => {
    const onAnalyze = vi.fn();
    const state = analyzeReducer(INITIAL_ANALYZE_STATE, {
      type: "select",
      imageDataUrl: PNG,
      mimeType: "image/png",
    });
    render({ state, onAnalyze });
    expect($("[data-analyze-preview]")).not.toBeNull();
    expect(($("[data-analyze-run]") as HTMLButtonElement).disabled).toBe(false);
    act(() => $("[data-analyze-run]").click());
    expect(onAnalyze).toHaveBeenCalled();
  });

  it("分析中禁用按钮并显示进度文案", () => {
    const state = analyzeReducer(
      analyzeReducer(INITIAL_ANALYZE_STATE, { type: "select", imageDataUrl: PNG, mimeType: "image/png" }),
      { type: "analyze" },
    );
    render({ state });
    expect($("[data-analyze-status]").getAttribute("data-status")).toBe("analyzing");
    expect($("[data-analyze-status]").textContent).toContain("分析中");
    expect(($("[data-analyze-run]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("完成后显示能力来源标记", () => {
    const state = analyzeReducer(
      analyzeReducer(INITIAL_ANALYZE_STATE, { type: "select", imageDataUrl: PNG, mimeType: "image/png" }),
      { type: "ready" },
    );
    render({ state, source: "demo" });
    expect($("[data-analyze-source]").textContent).toContain("DEMO");
  });

  it("失败展示错误", () => {
    const state = analyzeReducer(INITIAL_ANALYZE_STATE, { type: "fail", error: "网络错误" });
    render({ state });
    expect($("[data-analyze-error]").textContent).toContain("网络错误");
  });
});
