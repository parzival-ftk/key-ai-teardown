// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReportView, type ReportData } from "./report-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 元数据声明已回应、但 PRD 正文没写 [Cn] 标记 —— 精确锚点不存在的情形 */
const METADATA_ONLY: ReportData = {
  name: "Notion",
  sections: [
    {
      agentId: "devils-advocate",
      name: "反方质疑官",
      status: "done",
      output: "C1. 壁垒可能被抹平。\nC2. 掌控感也可能是焦虑。",
    },
    {
      agentId: "prd",
      name: "PRD 撰写官",
      status: "done",
      output: "### 用户故事\n- 一键模板开始\n- 邀请成员",
      addressedCriticIds: ["C1", "C2"],
    },
  ],
};

const WITH_ANCHORS: ReportData = {
  name: "Notion",
  sections: [
    METADATA_ONLY.sections[0],
    {
      agentId: "prd",
      name: "PRD 撰写官",
      status: "done",
      output: "### 用户故事\n- 一键模板开始 [C1]\n- 邀请成员 [C2]",
      addressedCriticIds: ["C1", "C2"],
    },
  ],
};

describe("报告页跳转（回归：精确锚点缺失时不得静默落空）", () => {
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

  const mount = async (data: ReportData) => {
    await act(async () => {
      root.render(<ReportView id="t" initialData={data} />);
    });
  };

  it("正文无 [Cn]：跳到 PRD 段落锚点并高亮该段（回退生效）", async () => {
    await mount(METADATA_ONLY);
    const jump = container.querySelector('[data-critic-jump="C1"]') as HTMLElement;
    expect(jump).not.toBeNull();
    await act(async () => jump.click());

    const prdSection = container.querySelector("#section-prd");
    expect(prdSection).not.toBeNull();
    expect(prdSection?.className).toContain("key-pulse");
  });

  it("正文有 [Cn]：跳到精确标记并高亮它，且高亮不串到别的质疑", async () => {
    await mount(WITH_ANCHORS);
    const jump = container.querySelector('[data-critic-jump="C1"]') as HTMLElement;
    await act(async () => jump.click());

    const marker = container.querySelector('[data-prd-ref="C1"]');
    const other = container.querySelector('[data-prd-ref="C2"]');
    expect(marker?.className).toContain("key-pulse");
    expect(other?.className).not.toContain("key-pulse");
  });

  it("从 PRD 标记跳回质疑条目并高亮", async () => {
    await mount(WITH_ANCHORS);
    const marker = container.querySelector('[data-prd-ref="C2"]') as HTMLElement;
    await act(async () => marker.click());

    const item = container.querySelector('[data-critic-item="C2"]');
    const otherItem = container.querySelector('[data-critic-item="C1"]');
    expect(item?.className).toContain("key-pulse");
    expect(otherItem?.className).not.toContain("key-pulse");
  });

  it("报告页为每个段落提供 section-<agentId> 锚点（回退目标）", async () => {
    await mount(METADATA_ONLY);
    expect(container.querySelector("#section-devils-advocate")).not.toBeNull();
    expect(container.querySelector("#section-prd")).not.toBeNull();
  });
});
