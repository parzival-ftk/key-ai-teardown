// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeInterventionModal, presetsForAgent } from "./NodeInterventionModal";
import type { ThoughtTreeNode } from "@/lib/agents/thought-tree";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODE: ThoughtTreeNode = {
  id: "node-2",
  kind: "branch",
  agentId: "prd",
  agentLabel: "PrdAgent",
  title: "每条用户故事都要挂回一条质疑",
  detail: "思考：……",
  stepIndexes: [2],
  reportAnchor: "section-prd",
  children: [],
};

describe("presetsForAgent", () => {
  it("按 Agent 角色给出预设指令", () => {
    const prd = presetsForAgent("prd");
    expect(prd).toContain("补充安全性约束");
    expect(presetsForAgent("market").length).toBeGreaterThan(0);
  });

  it("未知 / 缺省 Agent 回退到通用预设", () => {
    expect(presetsForAgent(undefined)).toContain("补充安全性约束");
    expect(presetsForAgent("no-such-agent")).toContain("补充安全性约束");
  });
});

describe("NodeInterventionModal（服务端静态渲染）", () => {
  it("open=false 不渲染", () => {
    expect(
      renderToStaticMarkup(
        <NodeInterventionModal open={false} node={NODE} onSubmit={() => {}} onClose={() => {}} />,
      ),
    ).toBe("");
  });

  it("open=true 渲染节点信息、预设与提交按钮", () => {
    const html = renderToStaticMarkup(
      <NodeInterventionModal open node={NODE} onSubmit={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain("data-node-intervention-modal");
    expect(html).toContain("每条用户故事都要挂回一条质疑");
    expect(html).toContain("PRD 撰写官");
    expect(html).toContain("重新推理此分支");
    expect(html).toContain("data-intervention-preset");
    expect(html).toContain("data-intervention-input");
  });

  it("未填写指令时提交按钮禁用", () => {
    const html = renderToStaticMarkup(
      <NodeInterventionModal open node={NODE} onSubmit={() => {}} onClose={() => {}} />,
    );
    expect(html).toMatch(/data-intervention-submit[^>]*disabled/);
  });
});

describe("NodeInterventionModal 交互（jsdom）", () => {
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
  const input = () =>
    container.querySelector("[data-intervention-input]") as HTMLTextAreaElement;
  const submit = () =>
    container.querySelector("[data-intervention-submit]") as HTMLButtonElement;
  const type = (value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("点击预设填入指令并启用提交", () => {
    mount(<NodeInterventionModal open node={NODE} onSubmit={() => {}} onClose={() => {}} />);
    expect(submit().disabled).toBe(true);
    const preset = container.querySelector(
      '[data-intervention-preset="补充安全性约束"]',
    ) as HTMLButtonElement;
    expect(preset).not.toBeNull();
    act(() => preset.click());
    expect(input().value).toBe("补充安全性约束");
    expect(submit().disabled).toBe(false);
  });

  it("提交触发回调（携带指令）并关闭弹窗", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    mount(<NodeInterventionModal open node={NODE} onSubmit={onSubmit} onClose={onClose} />);
    type("补充 GDPR 验收标准");
    await act(async () => {
      submit().click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("补充 GDPR 验收标准");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("取消不触发提交", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    mount(<NodeInterventionModal open node={NODE} onSubmit={onSubmit} onClose={onClose} />);
    type("x");
    act(() =>
      (container.querySelector("[data-intervention-cancel]") as HTMLElement).click(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("异步重算期间禁用提交并显示「重算中…」，完成后关闭", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(
      () => new Promise<void>((r) => { resolve = r; }),
    );
    const onClose = vi.fn();
    mount(<NodeInterventionModal open node={NODE} onSubmit={onSubmit} onClose={onClose} />);
    type("补充安全性约束");

    await act(async () => {
      submit().click();
    });
    expect(submit().textContent).toContain("重算中");
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
