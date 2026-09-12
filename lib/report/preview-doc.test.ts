import { describe, it, expect } from "vitest";
import { buildPreviewDoc } from "./preview-doc";

describe("预览文档构造（W7 降级版：只读预览）", () => {
  it("包含完整 HTML 骨架与 body 内容", () => {
    const doc = buildPreviewDoc('<div class="p-4">hi</div>', "/x.css");
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain('<div class="p-4">hi</div>');
    expect(doc).toContain('href="/x.css"');
    expect(doc).toContain("viewport");
  });

  it("CSS href 缺失时不生成空 link", () => {
    const doc = buildPreviewDoc("<p>x</p>", "");
    expect(doc).not.toContain("<link");
  });

  it("含基础 reset（去掉 body 默认边距）", () => {
    expect(buildPreviewDoc("<p>x</p>", "/x.css")).toContain("margin:0");
  });

  it("不注入任何脚本（沙箱只读预览，防 LLM 代码执行）", () => {
    expect(buildPreviewDoc("<p>x</p>", "/x.css")).not.toContain("<script");
  });
});
