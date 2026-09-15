// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * 避免在 jsdom 里跑真实 mermaid（重且依赖浏览器 API）。
 * `vi.mock` 会被提升到 import 之前，动态 `import("mermaid")` 同样会被拦截。
 */
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })),
  },
}));

import { ReportView, type ReportData } from "./report-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * W19 · 报告页「图谱编辑 → PRD 双向同步」集成测试。
 * 验证需求 3：编辑后必须同时反映在 **PRD 正文（含 [Cn] 锚点）**、**图谱渲染** 与 **导出内容** 上。
 */

const ORIGINAL_FLOW = "flowchart TD\n  A[进入] --> B[选模板]";
const NEW_FLOW = "flowchart LR\n  X[首页] --> Y[详情]";

const PRD_TEXT = `## 用户故事

- 一键模板开始 [C1]

\`\`\`mermaid
${ORIGINAL_FLOW}
\`\`\`

- 结尾说明 [C2]`;

const DATA: ReportData = {
  name: "Notion",
  sections: [
    { agentId: "prd", name: "PRD 撰写官", status: "done", output: PRD_TEXT },
  ],
};

describe("报告页：图谱编辑与 PRD 双向同步（W19）", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "# 报告",
    }));
    vi.stubGlobal("fetch", fetchMock);
    // jsdom 未实现 Blob URL：只补这两个静态方法，**不要整体替换全局 URL**
    // （`{...URL}` 会把 URL 构造函数变成普通对象，破坏 `new URL()`）。
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:stub"),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = async () => {
    await act(async () => {
      root.render(<ReportView id="t" initialData={DATA} />);
      await Promise.resolve();
    });
  };

  const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
  const source = () => $("[data-mermaid-source]").textContent ?? "";

  /**
   * 有界等待断言成立。
   * 该文件的断言跨越「子组件 → 父组件 → 子组件重渲染」的链路，在全量并行跑时
   * 偶发被调度抖动拖慢（单文件 10/10 通过、全量并行偶发一次）。轮询到条件成立即返回；
   * 若行为真的坏了，仍会在超时后抛出原始断言错误 —— 不掩盖缺陷。
   */
  const waitFor = async (assert: () => void, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        assert();
        return;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
    }
  };

  const setSource = async (value: string) => {
    const el = $("[data-editor-source]") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("初始：图谱源码为 AI 产出，PRD 的 [Cn] 锚点已渲染", async () => {
    await mount();
    expect(source()).toContain(ORIGINAL_FLOW);
    expect(container.querySelector('[data-prd-ref="C1"]')).not.toBeNull();
    expect(container.querySelector('[data-prd-ref="C2"]')).not.toBeNull();
    expect(container.querySelector("[data-section-edited]")).toBeNull();
  });

  it("编辑并应用 → 图谱渲染与 PRD 锚点同步更新，且出现「已编辑」标记", async () => {
    await mount();

    await act(async () => $('[data-mermaid-action="edit"]').click());
    expect(container.querySelector("[data-mermaid-editor]")).not.toBeNull();

    await setSource(NEW_FLOW);
    await act(async () => $('[data-editor-action="apply"]').click());

    // 1) 图谱渲染源已更新
    await waitFor(() => expect(source()).toContain(NEW_FLOW));
    // 2) PRD 正文的追溯锚点未被破坏
    expect(container.querySelector('[data-prd-ref="C1"]')).not.toBeNull();
    expect(container.querySelector('[data-prd-ref="C2"]')).not.toBeNull();
    // 3) 段落标记
    expect(container.querySelector("[data-section-edited]")).not.toBeNull();
  });

  it("编辑后导出 → 送往 /api/export 的 sections 含新图谱源码", async () => {
    await mount();

    await act(async () => $('[data-mermaid-action="edit"]').click());
    await setSource(NEW_FLOW);
    await act(async () => $('[data-editor-action="apply"]').click());

    await act(async () => {
      const exportBtn = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("下载报告（Markdown）"),
      ) as HTMLElement;
      exportBtn.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      sections: { agentId: string; output: string }[];
    };
    const prd = body.sections.find((s) => s.agentId === "prd");
    expect(prd?.output).toContain(NEW_FLOW);
    expect(prd?.output).not.toContain(ORIGINAL_FLOW);
    // 不变量：导出文本里的追溯锚点数量不变
    expect((prd?.output.match(/\[C\d+\]/g) ?? []).length).toBe(2);
  });

  it("「还原为 AI 初始图谱」→ 图谱渲染回到初版", async () => {
    await mount();

    await act(async () => $('[data-mermaid-action="edit"]').click());
    await setSource(NEW_FLOW);
    await act(async () => $('[data-editor-action="apply"]').click());
    await waitFor(() => expect(source()).toContain(NEW_FLOW));

    await act(async () => {
      $('[data-editor-action="revert"]').click();
      await Promise.resolve();
    });
    await waitFor(() => expect(source()).toContain(ORIGINAL_FLOW));
    // 「已编辑」标记应随内容回到原稿而消失（它反映的是「与 AI 原稿不同」，不是「曾改过」）
    await waitFor(() =>
      expect(container.querySelector("[data-section-edited]")).toBeNull(),
    );
  });
});
