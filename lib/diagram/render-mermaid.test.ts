import { describe, it, expect, vi } from "vitest";
import { renderMermaidSvg, type MermaidRenderer } from "./render-mermaid";

const okRenderer: MermaidRenderer = async (code, id) => `<svg id="${id}">${code}</svg>`;

describe("renderMermaidSvg", () => {
  it("渲染成功 → 返回 svg，并把源码交给渲染器", async () => {
    const renderer = vi.fn(okRenderer);
    const out = await renderMermaidSvg("flowchart TD\n A-->B", "m1", renderer);
    expect(out.error).toBeUndefined();
    expect(out.svg).toContain("<svg");
    expect(renderer).toHaveBeenCalledWith("flowchart TD\n A-->B", "m1");
  });

  it("空源码 → 直接返回错误（不调用渲染器）", async () => {
    const renderer = vi.fn(okRenderer);
    expect((await renderMermaidSvg("   ", "m1", renderer)).error).toBe("图谱源码为空");
    expect(renderer).not.toHaveBeenCalled();
  });

  it("渲染器抛错（非法语法）→ 降级为 error，不向上抛", async () => {
    const renderer: MermaidRenderer = async () => {
      throw new Error("Parse error on line 2");
    };
    const out = await renderMermaidSvg("flowchart TD\n ???", "m1", renderer);
    expect(out.svg).toBeUndefined();
    expect(out.error).toContain("Parse error");
  });

  it("渲染器返回空串 → 视为失败（不假装成功）", async () => {
    const out = await renderMermaidSvg("flowchart TD", "m1", async () => "   ");
    expect(out.error).toBe("渲染结果为空");
  });

  it("非 Error 抛出物也能降级", async () => {
    const out = await renderMermaidSvg("flowchart TD", "m1", async () => {
      throw "字符串异常";
    });
    expect(out.error).toBe("Mermaid 渲染失败（语法可能不合法）");
  });

  it("每个调用点用独立 id（避免 mermaid 内部 id 冲突）", async () => {
    const ids: string[] = [];
    const renderer: MermaidRenderer = async (_c, id) => {
      ids.push(id);
      return "<svg/>";
    };
    await renderMermaidSvg("flowchart TD", "a", renderer);
    await renderMermaidSvg("flowchart TD", "b", renderer);
    expect(ids).toEqual(["a", "b"]);
  });
});
