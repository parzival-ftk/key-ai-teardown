import { describe, it, expect } from "vitest";
import { buildPreviewDoc, stripScripts } from "./preview-doc";

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

describe("脚本净化（W7 · allow-same-origin 沙箱的前置条件）", () => {
  it("剥掉成对的 <script> 块，保留周围内容", () => {
    const out = stripScripts(
      "<div>a</div><script>alert(1)</script><div>b</div>",
    );
    expect(out).toContain("<div>a</div>");
    expect(out).toContain("<div>b</div>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("剥掉残留的 script 标签（含自闭合）", () => {
    expect(stripScripts('<script src="evil.js">')).not.toContain("script");
  });

  it("大小写不敏感", () => {
    expect(stripScripts("<SCRIPT>bad()</SCRIPT>")).toBe("");
  });

  it("buildPreviewDoc 对 body 一并净化", () => {
    const doc = buildPreviewDoc("<p>x</p><script>bad()</script>", "/x.css");
    expect(doc).not.toContain("bad()");
    expect(doc).toContain("<p>x</p>");
  });
});
