// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CriticList, PrdText } from "./traceable-text";
import { buildTraceability } from "@/lib/report/traceability";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CRITIC = [
  "### 被质疑的假设",
  "C1. 壁垒可能被模板生态抹平。",
  "C2. 「掌控感」也可能是工具焦虑的来源。",
  "C3. 中文社区供给缺乏数据。",
].join("\n");
const PRD = "### 用户故事\n- 一键模板开始 [C1]\n- 邀请与权限 [C2]";

const traceability = buildTraceability(CRITIC, PRD);

describe("CriticList（服务端渲染）", () => {
  const html = renderToStaticMarkup(
    <CriticList text={CRITIC} traceability={traceability} onJump={() => {}} pulseTarget={null} />,
  );

  it("每条编号质疑渲染为带锚点的条目", () => {
    for (const id of ["C1", "C2", "C3"]) {
      expect(html).toContain(`id="critic-${id.toLowerCase()}"`);
      expect(html).toContain(`data-critic-item="${id}"`);
    }
  });

  it("标注是否被 PRD 回应（C1/C2 已回应，C3 未回应）", () => {
    expect(html).toContain('data-critic-item="C1"');
    expect(html).toContain('data-critic-addressed="true"');
    expect(html).toContain('data-critic-addressed="false"');
    expect(html).toContain("PRD 已回应");
    expect(html).toContain("PRD 未回应");
  });

  it("给出回应覆盖率摘要并点名未回应项", () => {
    expect(html).toContain("质疑回应情况：已回应 2/3");
    expect(html).toContain("未回应 C3");
  });

  it("非编号行按普通文本渲染", () => {
    expect(html).toContain("### 被质疑的假设");
  });
});

describe("PrdText（服务端渲染）", () => {
  it("把 [Cn] 渲染成带锚点的可点击标记，其余文本保留", () => {
    const html = renderToStaticMarkup(
      <PrdText text={PRD} onJump={() => {}} pulseTarget={null} />,
    );
    expect(html).toContain('id="prd-ref-c1"');
    expect(html).toContain('data-prd-ref="C1"');
    expect(html).toContain('data-prd-ref="C2"');
    expect(html).toContain("一键模板开始");
  });
});

describe("跳转触发（真实 DOM 点击 → onJump 收到对侧锚点）", () => {
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

  const click = (el: Element) => {
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("点质疑条目 → 跳到 PRD 侧锚点", () => {
    const onJump = vi.fn();
    act(() =>
      root.render(
        <CriticList text={CRITIC} traceability={traceability} onJump={onJump} pulseTarget={null} />,
      ),
    );
    const button = container.querySelector('[data-critic-jump="C2"]');
    expect(button).not.toBeNull();
    click(button!);
    expect(onJump).toHaveBeenCalledWith("prd-ref-c2");
  });

  it("点 PRD 标记 → 跳回质疑侧锚点", () => {
    const onJump = vi.fn();
    act(() =>
      root.render(<PrdText text={PRD} onJump={onJump} pulseTarget={null} />),
    );
    const marker = container.querySelector('[data-prd-ref="C1"]');
    expect(marker).not.toBeNull();
    click(marker!);
    expect(onJump).toHaveBeenCalledWith("critic-c1");
  });

  it("pulseTarget 命中时挂上脉冲高亮类", () => {
    act(() =>
      root.render(<PrdText text={PRD} onJump={() => {}} pulseTarget="prd-ref-c1" />),
    );
    const marker = container.querySelector('[data-prd-ref="C1"]');
    expect(marker?.className).toContain("key-pulse");
    const other = container.querySelector('[data-prd-ref="C2"]');
    expect(other?.className).not.toContain("key-pulse");
  });

  it("质疑条目的 id 与 PRD 标记的跳转目标能对上（双向锚点闭环）", () => {
    act(() =>
      root.render(
        <>
          <CriticList text={CRITIC} traceability={traceability} onJump={() => {}} pulseTarget={null} />
          <PrdText text={PRD} onJump={() => {}} pulseTarget={null} />
        </>,
      ),
    );
    // 质疑 C1 存在的锚点 id，与 PRD 标记的 onJump 目标一致
    expect(container.querySelector("#critic-c1")).not.toBeNull();
    expect(container.querySelector("#prd-ref-c1")).not.toBeNull();
  });
});
