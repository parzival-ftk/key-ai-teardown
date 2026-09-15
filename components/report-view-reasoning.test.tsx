// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReportView, type ReportData } from "./report-view";
import { parseReasoningTrace } from "@/lib/agents/reasoning-parser";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * W23 集成：报告页「Agent 推理过程」面板 —— 入口 → 双视图切换 → 树节点点击联动高亮报告区块。
 */

const DATA: ReportData = {
  name: "Notion",
  sections: [
    {
      agentId: "prd",
      name: "PRD 撰写官",
      status: "done",
      output: "### 用户故事\n- 一键模板开始 [C1]",
      addressedCriticIds: ["C1"],
    },
    {
      agentId: "devils-advocate",
      name: "反方质疑官",
      status: "done",
      output: "C1. 壁垒可能被抹平。",
    },
  ],
  reasoningTrace: parseReasoningTrace(
    [
      "PrdAgent:",
      "Thought: **每条用户故事都要挂回一条质疑**。",
      "",
      "RebuttalAgent:",
      "Thought: 结论：模板生态可能是伪壁垒。",
    ].join("\n"),
  ),
};

describe("报告页 W23：推理面板双视图与树节点联动", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // jsdom 不实现 scrollIntoView
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = () =>
    act(() => root.render(<ReportView id="t" initialData={DATA} />));

  it("默认不渲染推理面板；点击入口后展开并默认展示时间轴", () => {
    mount();
    expect(container.querySelector("[data-reasoning-panel]")).toBeNull();

    act(() =>
      (container.querySelector("[data-reasoning-entry]") as HTMLElement).click(),
    );
    expect(container.querySelector("[data-reasoning-panel]")).not.toBeNull();
    expect(container.querySelector("[data-reasoning-timeline]")).not.toBeNull();
    expect(container.querySelector("[data-thought-tree]")).toBeNull();
  });

  it("切到 Tree View 渲染思维树，点击节点高亮对应报告区块", () => {
    mount();
    act(() =>
      (container.querySelector("[data-reasoning-entry]") as HTMLElement).click(),
    );
    act(() =>
      (
        container.querySelector('[data-reasoning-tab="tree"]') as HTMLElement
      ).click(),
    );
    expect(container.querySelector("[data-thought-tree]")).not.toBeNull();

    const prdNode = container.querySelector(
      '[data-thought-agent="prd"]',
    ) as HTMLElement;
    const toggle = prdNode.querySelector(
      "[data-thought-node-toggle]",
    ) as HTMLElement;
    act(() => toggle.click());

    // 点击 prd 节点 → 报告页 PRD 段被脉冲高亮
    const section = container.querySelector("#section-prd");
    expect(section).not.toBeNull();
    expect(section?.className).toContain("key-pulse");
  });
});
