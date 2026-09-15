// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ReasoningTimeline } from "./ReasoningTimeline";
import { parseReasoningTrace } from "@/lib/agents/reasoning-parser";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOG = [
  "PrdAgent:",
  "Thought: 用户痛点是模板碎片化，**模板生态才是护城河**。",
  'Action: draft_prd("模板中心")',
  "Observation: 生成 5 条用户故事，耗时 1.2s",
  "",
  "RebuttalAgent:",
  "Thought: 结论：壁垒可能被抹平。",
].join("\n");

const STEPS = parseReasoningTrace(LOG);

describe("ReasoningTimeline（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(<ReasoningTimeline steps={STEPS} />);

  it("渲染每个步骤节点，带 kind/agent 标记", () => {
    expect((html.match(/data-reasoning-step=/g) ?? []).length).toBe(STEPS.length);
    expect(html).toContain('data-reasoning-agent="prd"');
    expect(html).toContain('data-reasoning-agent="rebuttal"');
    expect(html).toContain('data-reasoning-kind="thought"');
    expect(html).toContain('data-reasoning-kind="action"');
    expect(html).toContain('data-reasoning-kind="observation"');
  });

  it("展示 Agent 展示名（来自章节定义的 owner）与中文步骤类型", () => {
    expect(html).toContain("PRD 撰写官");
    expect(html).toContain("答辩官");
    expect(html).toContain("思考");
    expect(html).toContain("观察");
  });

  it("展示关键推理断言与 Action 提示", () => {
    expect(html).toContain("模板生态才是护城河");
    expect(html).toContain('data-reasoning-assertion');
    expect(html).toContain("draft_prd");
    expect(html).toContain('data-reasoning-action');
  });

  it("展示耗时统计（节点耗时 + 合计）", () => {
    expect(html).toContain("1.2s");
    expect(html).toContain("data-reasoning-total-duration");
  });

  it("默认展开所有细节", () => {
    expect((html.match(/data-reasoning-detail/g) ?? []).length).toBe(STEPS.length);
  });

  it("空 steps → 渲染空态提示而非空白/报错", () => {
    const empty = renderToStaticMarkup(<ReasoningTimeline steps={[]} />);
    expect(empty).toContain("data-reasoning-empty");
    expect(empty).not.toContain("data-reasoning-step=");
  });
});

describe("ReasoningTimeline 交互（jsdom）", () => {
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

  const mount = () => act(() => root.render(<ReasoningTimeline steps={STEPS} />));
  const details = () => container.querySelectorAll("[data-reasoning-detail]");
  const stepsRendered = () => container.querySelectorAll("[data-reasoning-step]");
  const expandAll = () =>
    container.querySelector("[data-reasoning-expand-all]") as HTMLButtonElement;

  it("「展开/收起全部细节」切换所有节点", () => {
    mount();
    expect(details()).toHaveLength(STEPS.length);
    act(() => expandAll().click());
    expect(details()).toHaveLength(0);
    expect(expandAll().textContent).toContain("展开全部细节");
    act(() => expandAll().click());
    expect(details()).toHaveLength(STEPS.length);
  });

  it("单节点折叠按钮只影响该节点", () => {
    mount();
    const toggle = container.querySelector(
      '[data-reasoning-step="0"] [data-reasoning-toggle]',
    ) as HTMLButtonElement;
    act(() => toggle.click());
    expect(details()).toHaveLength(STEPS.length - 1);
    expect(
      container.querySelector('[data-reasoning-step="0"] [data-reasoning-detail]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-reasoning-step="1"] [data-reasoning-detail]'),
    ).not.toBeNull();
  });

  it("按 Agent 筛选只保留该 Agent 的步骤，可切回全部", () => {
    mount();
    expect(stepsRendered()).toHaveLength(STEPS.length);
    act(() =>
      (container.querySelector('[data-reasoning-filter="prd"]') as HTMLElement).click(),
    );
    expect(stepsRendered()).toHaveLength(3);
    container
      .querySelectorAll("[data-reasoning-step]")
      .forEach((el) =>
        expect(el.getAttribute("data-reasoning-agent")).toBe("prd"),
      );
    act(() =>
      (container.querySelector('[data-reasoning-filter="all"]') as HTMLElement).click(),
    );
    expect(stepsRendered()).toHaveLength(STEPS.length);
  });
});
