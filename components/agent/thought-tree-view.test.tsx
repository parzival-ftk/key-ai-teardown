// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ThoughtTreeView } from "./ThoughtTreeView";
import { parseReasoningTrace } from "@/lib/agents/reasoning-parser";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOG = [
  "MarketAgent:",
  "Thought: **没有统一心智就没有对比**。",
  "Observation: 识别 4 个竞品，耗时 1.1s",
  "",
  "PrdAgent:",
  "Thought: **每条用户故事都要挂回一条质疑**。",
  'Action: draft_prd("模板中心")',
  "",
  "RebuttalAgent:",
  "Thought: 结论：模板生态可能是伪壁垒。",
].join("\n");

const STEPS = parseReasoningTrace(LOG);

describe("ThoughtTreeView（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(<ThoughtTreeView steps={STEPS} />);

  it("渲染根节点与各类型节点", () => {
    expect(html).toContain("data-thought-tree");
    expect(html).toContain('data-thought-kind="root"');
    expect(html).toContain('data-thought-kind="branch"');
    expect(html).toContain('data-thought-kind="conflict"');
  });

  it("区分 Agent 角色徽章与展示名", () => {
    expect(html).toContain('data-thought-agent="market"');
    expect(html).toContain('data-thought-agent="prd"');
    expect(html).toContain('data-thought-agent="rebuttal"');
    expect(html).toContain("竞品分析师");
    expect(html).toContain("PRD 撰写官");
    expect(html).toContain("答辩官");
  });

  it("博弈节点带冲突标记与类型标签", () => {
    expect(html).toContain('data-thought-kind="conflict"');
    expect(html).toContain("博弈");
    expect(html).toContain("data-thought-conflict");
  });

  it("默认收起节点细节", () => {
    expect(html).not.toContain("data-thought-detail");
  });

  it("空步骤 → 空态提示而非报错", () => {
    const empty = renderToStaticMarkup(<ThoughtTreeView steps={[]} />);
    expect(empty).toContain("data-thought-tree-empty");
  });
});

describe("ThoughtTreeView 节点点击联动（jsdom）", () => {
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

  const mount = (ui: React.ReactElement) => act(() => root.render(ui));
  const nodeEl = (agent: string) =>
    container.querySelector(`[data-thought-agent="${agent}"]`) as HTMLElement;

  it("点击节点展开细节并回调 onSelectNode（携带报告锚点）", () => {
    const onSelect = vi.fn();
    mount(<ThoughtTreeView steps={STEPS} onSelectNode={onSelect} />);

    const prd = nodeEl("prd");
    const id = prd.getAttribute("data-thought-node")!;
    const toggle = prd.querySelector("[data-thought-node-toggle]") as HTMLButtonElement;

    act(() => toggle.click());
    const detail = container.querySelector(`[data-thought-detail="${id}"]`);
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("思考");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].reportAnchor).toBe("section-prd");

    act(() => toggle.click());
    expect(container.querySelector(`[data-thought-detail="${id}"]`)).toBeNull();
  });

  it("嵌套节点层级正确（prd → rebuttal 深度 2）", () => {
    mount(<ThoughtTreeView steps={STEPS} />);
    const prd = nodeEl("prd");
    const rebuttal = nodeEl("rebuttal");
    expect(prd.contains(rebuttal)).toBe(true);
    expect(rebuttal.getAttribute("data-thought-depth")).toBe("2");
  });
});
