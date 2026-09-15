import { describe, it, expect } from "vitest";
import {
  detectDiagramKind,
  extractMermaidBlocks,
  isSupportedDiagram,
  stripMermaidBlocks,
} from "./mermaid-blocks";

const FLOW = "```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```";
const STATE = "```mermaid\nstateDiagram-v2\n  [*] --> 空闲\n 空闲 --> 运行\n```";

describe("detectDiagramKind", () => {
  it("识别 flowchart / graph / stateDiagram(-v2)", () => {
    expect(detectDiagramKind("flowchart TD\n A-->B")).toBe("flowchart");
    expect(detectDiagramKind("graph LR\n A-->B")).toBe("flowchart");
    expect(detectDiagramKind("stateDiagram-v2\n [*] --> A")).toBe("state");
    expect(detectDiagramKind("stateDiagram\n [*] --> A")).toBe("state");
  });

  it("容忍前置空行与 %% 注释", () => {
    expect(detectDiagramKind("\n\n%% 说明\nflowchart TD\nA-->B")).toBe(
      "flowchart",
    );
  });

  it("其它/空内容 → other", () => {
    expect(detectDiagramKind("sequenceDiagram\n A->>B: hi")).toBe("other");
    expect(detectDiagramKind("")).toBe("other");
    expect(detectDiagramKind("%% 只有注释")).toBe("other");
  });

  it("isSupportedDiagram 只认 flowchart 与 state", () => {
    expect(isSupportedDiagram("flowchart")).toBe(true);
    expect(isSupportedDiagram("state")).toBe(true);
    expect(isSupportedDiagram("other")).toBe(false);
  });
});

describe("extractMermaidBlocks", () => {
  it("提取单个块并带序号与类型", () => {
    const blocks = extractMermaidBlocks(`说明文字\n\n${FLOW}\n\n更多文字`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].index).toBe(0);
    expect(blocks[0].kind).toBe("flowchart");
    expect(blocks[0].code).toContain("flowchart TD");
    expect(blocks[0].code).not.toContain("```");
  });

  it("提取多个块（顺序即序号）", () => {
    const blocks = extractMermaidBlocks(`${FLOW}\n\n中间\n\n${STATE}`);
    expect(blocks.map((b) => b.kind)).toEqual(["flowchart", "state"]);
    expect(blocks.map((b) => b.index)).toEqual([0, 1]);
  });

  it("忽略非 mermaid 围栏（如 html / json）", () => {
    const md = "```html\n<div>hi</div>\n```\n\n```json\n{\"a\":1}\n```";
    expect(extractMermaidBlocks(md)).toEqual([]);
  });

  it("未闭合的围栏不匹配（不吞后续正文）", () => {
    const md = "```mermaid\nflowchart TD\nA-->B\n\n后面还有正文";
    expect(extractMermaidBlocks(md)).toEqual([]);
  });

  it("空正文返回空数组", () => {
    expect(extractMermaidBlocks("")).toEqual([]);
  });
});

describe("stripMermaidBlocks", () => {
  it("去掉 mermaid 围栏但保留其余正文", () => {
    const text = stripMermaidBlocks(`前文\n\n${FLOW}\n\n后文`);
    expect(text).toContain("前文");
    expect(text).toContain("后文");
    expect(text).not.toContain("```");
    expect(text).not.toContain("flowchart TD");
  });

  it("不动其它语言的围栏", () => {
    const md = "```html\n<div>hi</div>\n```\n\n" + FLOW;
    const out = stripMermaidBlocks(md);
    expect(out).toContain("```html");
    expect(out).toContain("<div>hi</div>");
    expect(out).not.toContain("mermaid");
  });
});
