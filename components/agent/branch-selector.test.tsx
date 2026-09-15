// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { BranchSelector } from "./BranchSelector";
import { buildThoughtTree } from "@/lib/agents/thought-tree";
import { parseReasoningTrace } from "@/lib/agents/reasoning-parser";
import type { Branch } from "@/lib/agents/branch-rerun";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tree = buildThoughtTree(parseReasoningTrace("PrdAgent:\nThought: 初版方案。"));

const BRANCHES: Branch[] = [
  { id: "main", label: "主推理分支 (Main)", tree, sectionOverrides: {} },
  {
    id: "branch-1",
    label: "分支 1: 补充 GDPR 验收标准 (Intervened)",
    instruction: "补充 GDPR 验收标准",
    targetNodeId: "node-1",
    tree,
    sectionOverrides: {},
  },
];

describe("BranchSelector（服务端静态渲染）", () => {
  const html = renderToStaticMarkup(
    <BranchSelector branches={BRANCHES} activeId="main" onSelect={() => {}} />,
  );

  it("渲染全部分支选项并标注当前分支", () => {
    expect(html).toContain("data-branch-selector");
    expect((html.match(/data-branch-option=/g) ?? []).length).toBe(2);
    expect(html).toContain("主推理分支 (Main)");
    expect(html).toContain("分支 1: 补充 GDPR 验收标准 (Intervened)");
    expect(html).toContain('aria-selected="true"');
  });

  it("无分支时不渲染", () => {
    expect(
      renderToStaticMarkup(
        <BranchSelector branches={[]} activeId="main" onSelect={() => {}} />,
      ),
    ).toBe("");
  });
});

describe("BranchSelector 交互（jsdom）", () => {
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

  it("点击分支触发切换回调", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <BranchSelector branches={BRANCHES} activeId="main" onSelect={onSelect} />,
      ),
    );
    act(() =>
      (
        container.querySelector('[data-branch-option="branch-1"]') as HTMLElement
      ).click(),
    );
    expect(onSelect).toHaveBeenCalledWith("branch-1");
    expect(
      container
        .querySelector('[data-branch-option="main"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });
});
