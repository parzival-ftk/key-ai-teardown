// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ReasoningPanel } from "./ReasoningPanel";
import { parseReasoningTrace } from "@/lib/agents/reasoning-parser";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STEPS = parseReasoningTrace(
  [
    "PrdAgent:",
    "Thought: **模板生态才是护城河**。",
    "Observation: 生成 5 条用户故事，耗时 1.2s",
    "",
    "RebuttalAgent:",
    "Thought: 结论：壁垒可能被抹平。",
  ].join("\n"),
);

describe("ReasoningPanel（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(<ReasoningPanel steps={STEPS} />);

  it("提供「线性时间轴」与「思维图树」两个选项卡", () => {
    expect(html).toContain('data-reasoning-tab="timeline"');
    expect(html).toContain('data-reasoning-tab="tree"');
    expect(html).toContain("线性时间轴");
    expect(html).toContain("Tree View");
  });

  it("默认展示线性时间轴", () => {
    expect(html).toContain("data-reasoning-timeline");
    expect(html).not.toContain("data-thought-tree");
    expect(html).toContain('aria-selected="true"');
  });
});

describe("ReasoningPanel 选项卡切换（jsdom）", () => {
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

  const mount = () => act(() => root.render(<ReasoningPanel steps={STEPS} />));
  const tab = (key: string) =>
    container.querySelector(`[data-reasoning-tab="${key}"]`) as HTMLButtonElement;

  it("切换到 Tree View 渲染思维树、移除时间轴；可切回", () => {
    mount();
    expect(container.querySelector("[data-reasoning-timeline]")).not.toBeNull();
    expect(container.querySelector("[data-thought-tree]")).toBeNull();

    act(() => tab("tree").click());
    expect(container.querySelector("[data-thought-tree]")).not.toBeNull();
    expect(container.querySelector("[data-reasoning-timeline]")).toBeNull();
    expect(tab("tree").getAttribute("aria-selected")).toBe("true");
    expect(tab("timeline").getAttribute("aria-selected")).toBe("false");

    act(() => tab("timeline").click());
    expect(container.querySelector("[data-reasoning-timeline]")).not.toBeNull();
    expect(container.querySelector("[data-thought-tree]")).toBeNull();
  });
});
