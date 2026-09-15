import { describe, it, expect } from "vitest";
import {
  countMermaidBlocks,
  getMermaidCodeAt,
  tryUpdateMermaidInPrd,
  updateMermaidInPrd,
} from "./diagram-sync";
import { extractMermaidBlocks, extractMermaidSpans } from "@/lib/diagram/mermaid-blocks";

/**
 * W19 · PRD ↔ Mermaid 双向同步引擎单测。
 *
 * 核心是**不变量保护**：编辑图谱只能动目标围栏的内部，PRD 的其余一切
 * （段落标题、正文、`[Cn]` 追溯锚点、其它图谱）必须逐字不变。
 */

const FLOW = "flowchart TD\n  A[进入] --> B[选模板]";
const STATE = "stateDiagram-v2\n  [*] --> 空工作区\n  空工作区 --> 已选模板";

const PRD = `## 用户故事

- 一键模板开始 [C1]
- 手动创建页面 [C2]

\`\`\`mermaid
${FLOW}
\`\`\`

### 风险

- 灵活是双刃剑 [C1][C2]

\`\`\`mermaid
${STATE}
\`\`\`

## 尾注

结束语 [C3]
`;

/** 把第 index 个围栏替换为占位符后的文本 —— 用于逐字比对「围栏之外」的部分 */
function outsideOfBlock(markdown: string, index: number): string {
  const span = extractMermaidSpans(markdown)[index];
  return markdown.slice(0, span.start) + "<BLOCK>" + markdown.slice(span.end);
}

const refsOf = (md: string) => md.match(/\[C\d+\]/g) ?? [];

describe("countMermaidBlocks / getMermaidCodeAt", () => {
  it("统计 mermaid 围栏数量", () => {
    expect(countMermaidBlocks(PRD)).toBe(2);
    expect(countMermaidBlocks("没有图谱的正文")).toBe(0);
    expect(countMermaidBlocks("")).toBe(0);
  });

  it("按序号取回围栏内的源码（已 trim）", () => {
    expect(getMermaidCodeAt(PRD, 0)).toBe(FLOW);
    expect(getMermaidCodeAt(PRD, 1)).toBe(STATE);
  });

  it("越界 / 非法序号返回 null", () => {
    expect(getMermaidCodeAt(PRD, 2)).toBeNull();
    expect(getMermaidCodeAt(PRD, -1)).toBeNull();
    expect(getMermaidCodeAt(PRD, 1.5)).toBeNull();
  });
});

describe("updateMermaidInPrd（精准替换）", () => {
  it("替换第 0 个图谱，第 1 个逐字不变", () => {
    const next = updateMermaidInPrd(PRD, 0, "flowchart LR\n  X --> Y");
    expect(getMermaidCodeAt(next, 0)).toBe("flowchart LR\n  X --> Y");
    expect(getMermaidCodeAt(next, 1)).toBe(STATE);
    expect(countMermaidBlocks(next)).toBe(2);
  });

  it("替换第 1 个图谱，第 0 个逐字不变", () => {
    const next = updateMermaidInPrd(PRD, 1, "stateDiagram-v2\n  [*] --> 完成");
    expect(getMermaidCodeAt(next, 0)).toBe(FLOW);
    expect(getMermaidCodeAt(next, 1)).toBe("stateDiagram-v2\n  [*] --> 完成");
  });

  it("不变量：围栏之外的所有文本逐字不变", () => {
    const next = updateMermaidInPrd(PRD, 0, "flowchart LR\n  X --> Y");
    expect(outsideOfBlock(next, 0)).toBe(outsideOfBlock(PRD, 0));
  });

  it("不变量：[Cn] 追溯锚点的数量与顺序不变", () => {
    const next = updateMermaidInPrd(PRD, 1, "stateDiagram-v2\n  [*] --> 完成");
    expect(refsOf(next)).toEqual(refsOf(PRD));
  });

  it("不变量：去掉图谱后的正文完全一致（标题/段落都保留）", () => {
    const next = updateMermaidInPrd(PRD, 0, "flowchart LR\n  X --> Y");
    expect(next).toContain("## 用户故事");
    expect(next).toContain("### 风险");
    expect(next).toContain("## 尾注");
    expect(next).toContain("- 一键模板开始 [C1]");
    expect(next).toContain("- 灵活是双刃剑 [C1][C2]");
    expect(next).toContain("结束语 [C3]");
  });

  it("幂等：同一替换执行两次结果一致", () => {
    const once = updateMermaidInPrd(PRD, 0, "flowchart LR\n  X --> Y");
    const twice = updateMermaidInPrd(once, 0, "flowchart LR\n  X --> Y");
    expect(twice).toBe(once);
  });

  it("替换后仍能被围栏解析器识别出同样数量的图谱", () => {
    const next = updateMermaidInPrd(PRD, 1, "stateDiagram-v2\n  [*] --> 完成");
    const blocks = extractMermaidBlocks(next);
    expect(blocks.map((b) => b.index)).toEqual([0, 1]);
    expect(blocks[1].code).toBe("stateDiagram-v2\n  [*] --> 完成");
  });
});

describe("updateMermaidInPrd（入参规范化与保护）", () => {
  it("传入带围栏的代码时剥离围栏，不产生嵌套", () => {
    const next = updateMermaidInPrd(
      PRD,
      0,
      "```mermaid\nflowchart LR\n  X --> Y\n```",
    );
    expect(next.match(/```mermaid/g)).toHaveLength(2); // 仍是两个围栏，未嵌套
    expect(getMermaidCodeAt(next, 0)).toBe("flowchart LR\n  X --> Y");
  });

  it("代码首尾空白被规范化", () => {
    const next = updateMermaidInPrd(PRD, 0, "\n\nflowchart LR\n  X --> Y\n\n");
    expect(getMermaidCodeAt(next, 0)).toBe("flowchart LR\n  X --> Y");
  });

  it("越界序号 → 原样返回（保护性 no-op）", () => {
    expect(updateMermaidInPrd(PRD, 5, "flowchart LR\n X --> Y")).toBe(PRD);
    expect(updateMermaidInPrd(PRD, -1, "flowchart LR\n X --> Y")).toBe(PRD);
  });

  it("没有图谱的正文 → 原样返回", () => {
    const plain = "只有正文 [C1]，没有图谱。";
    expect(updateMermaidInPrd(plain, 0, "flowchart LR\n X --> Y")).toBe(plain);
  });

  it("空输入不抛错", () => {
    expect(() => updateMermaidInPrd("", 0, "flowchart LR")).not.toThrow();
    expect(updateMermaidInPrd("", 0, "flowchart LR")).toBe("");
  });

  it("CRLF 正文同样被正确处理", () => {
    const crlf = PRD.replace(/\n/g, "\r\n");
    const next = updateMermaidInPrd(crlf, 1, "stateDiagram-v2\r\n  [*] --> 完成");
    expect(getMermaidCodeAt(next, 1)).toBe("stateDiagram-v2\r\n  [*] --> 完成");
    expect(countMermaidBlocks(next)).toBe(2);
  });

  it("tryUpdateMermaidInPrd 报告是否命中", () => {
    expect(tryUpdateMermaidInPrd(PRD, 0, "flowchart LR").applied).toBe(true);
    const miss = tryUpdateMermaidInPrd(PRD, 9, "flowchart LR");
    expect(miss.applied).toBe(false);
    expect(miss.markdown).toBe(PRD);
  });
});
