import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MermaidErrorFallback, MermaidViewer } from "./MermaidViewer";

const CODE = "flowchart TD\n  A[开始] --> B[结束]";

describe("MermaidViewer（服务端静态渲染 / 动态 mount 保护）", () => {
  it("SSR 阶段不渲染 SVG，只渲染占位符（避免 SSR 挂载错乱）", () => {
    const html = renderToStaticMarkup(<MermaidViewer code={CODE} />);
    expect(html).toContain('data-mermaid-status="rendering"');
    expect(html).toContain("图谱渲染中…");
    expect(html).not.toContain("data-mermaid-svg");
    // 服务端不能产出 mermaid 的结果
    expect(html).not.toContain("<svg");
  });

  it("工具栏含缩放 / 重置 / 全屏 / 复制四类动作", () => {
    const html = renderToStaticMarkup(<MermaidViewer code={CODE} />);
    for (const action of ["zoom-in", "zoom-out", "zoom-reset", "fullscreen", "copy"]) {
      expect(html, `缺动作 ${action}`).toContain(`data-mermaid-action="${action}"`);
    }
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("100%");
  });

  it("源码始终可见（details 里可展开）", () => {
    const html = renderToStaticMarkup(<MermaidViewer code={CODE} />);
    expect(html).toContain("查看 Mermaid 源码");
    expect(html).toContain("flowchart TD");
  });

  it("按图形类型给出标题", () => {
    expect(
      renderToStaticMarkup(<MermaidViewer code={CODE} kind="flowchart" />),
    ).toContain("流程图（Mermaid）");
    expect(
      renderToStaticMarkup(<MermaidViewer code={CODE} kind="state" />),
    ).toContain("状态图（Mermaid）");
    expect(
      renderToStaticMarkup(
        <MermaidViewer code={CODE} kind="other" title="自定义标题" />,
      ),
    ).toContain("自定义标题");
  });

  it("默认不以全屏渲染（全屏态无边框卡片样式）", () => {
    const html = renderToStaticMarkup(<MermaidViewer code={CODE} />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("fixed inset-0");
  });
});

describe("MermaidErrorFallback（非法语法降级）", () => {
  it("同时呈现错误原因与原始源码", () => {
    const html = renderToStaticMarkup(
      <MermaidErrorFallback code={CODE} error="Parse error on line 2" />,
    );
    expect(html).toContain("图谱渲染失败");
    expect(html).toContain("Parse error on line 2");
    expect(html).toContain("flowchart TD");
  });

  it("源码以文本渲染（不当作 HTML 注入）", () => {
    const html = renderToStaticMarkup(
      <MermaidErrorFallback
        code={'flowchart TD\n  A["<img src=x onerror=alert(1)>"]'}
        error="bad"
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
