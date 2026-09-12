import { describe, it, expect } from "vitest";
import { extractCodeBlocks, stripCodeBlocks } from "./code-blocks";

describe("Markdown 代码围栏提取（W6）", () => {
  it("提取单个带语言标识的围栏", () => {
    const md = ["说明文字", "```html", '<div class="p-4">hi</div>', "```"].join(
      "\n",
    );
    const blocks = extractCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe("html");
    expect(blocks[0].code).toBe('<div class="p-4">hi</div>');
  });

  it("提取多个围栏并保留顺序", () => {
    const md = [
      "```html",
      "<a>1</a>",
      "```",
      "中间的说明",
      "```css",
      ".x { color: red }",
      "```",
    ].join("\n");
    const blocks = extractCodeBlocks(md);
    expect(blocks.map((b) => b.lang)).toEqual(["html", "css"]);
  });

  it("无语言标识时 lang 为空串", () => {
    const blocks = extractCodeBlocks("```\nplain\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe("");
    expect(blocks[0].code).toBe("plain");
  });

  it("没有围栏时返回空数组", () => {
    expect(extractCodeBlocks("只有正文，没有代码")).toEqual([]);
  });

  it("未闭合的围栏不匹配（不吞掉后续正文）", () => {
    expect(extractCodeBlocks("```html\n<div>未闭合")).toEqual([]);
  });

  it("去掉代码块首尾多余的空白行", () => {
    const blocks = extractCodeBlocks("```html\n\n<div>x</div>\n\n```");
    expect(blocks[0].code).toBe("<div>x</div>");
  });
});

describe("剥离代码围栏（W6）", () => {
  it("去掉围栏与代码，保留说明文字", () => {
    const md = ["说明一", "```html", "<div>x</div>", "```", "说明二"].join("\n");
    const prose = stripCodeBlocks(md);
    expect(prose).toContain("说明一");
    expect(prose).toContain("说明二");
    expect(prose).not.toContain("<div>x</div>");
    expect(prose).not.toContain("```");
  });

  it("无围栏时原样返回（仅去首尾空白）", () => {
    expect(stripCodeBlocks("  纯正文  ")).toBe("纯正文");
  });

  it("多个围栏之间的正文被保留", () => {
    const md = "A\n```\n1\n```\nB\n```\n2\n```\nC";
    const prose = stripCodeBlocks(md);
    expect(prose).toContain("A");
    expect(prose).toContain("B");
    expect(prose).toContain("C");
  });
});
