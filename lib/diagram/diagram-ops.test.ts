import { describe, it, expect } from "vitest";
import { appendNode, appendState, formatDiagram } from "./diagram-ops";
import { detectDiagramKind } from "./mermaid-blocks";

/**
 * W19 · 图谱快捷编辑操作单测。
 * 判据：结果仍是**可被识别的同类型图谱**（不产生非法语法），且对异类源码 no-op。
 */

const FLOW = "flowchart TD\n  A[开始] --> B[结束]";
const STATE = "stateDiagram-v2\n  [*] --> 空工作区\n  空工作区 --> 已选模板";

describe("formatDiagram", () => {
  it("声明行顶格、其余行统一缩进两格，并折叠多余空行", () => {
    const messy = "flowchart TD\n\n\n      A[开始] --> B[结束]\n\n\n";
    expect(formatDiagram(messy)).toBe("flowchart TD\n\n  A[开始] --> B[结束]");
  });

  it("CRLF 归一为 LF", () => {
    expect(formatDiagram("flowchart TD\r\n  A --> B")).toBe("flowchart TD\n  A --> B");
  });

  it("去首尾空行；空输入 → 空串", () => {
    expect(formatDiagram("\n\n  \n")).toBe("");
    expect(formatDiagram("")).toBe("");
  });

  it("幂等：格式化两次结果一致", () => {
    const once = formatDiagram("flowchart TD\n\n\n   A --> B  \n");
    expect(formatDiagram(once)).toBe(once);
  });
});

describe("appendNode（flowchart）", () => {
  it("从首个节点连出一条边并追加新节点", () => {
    const out = appendNode(FLOW);
    expect(out).toContain("N1[新节点]");
    expect(out).toContain("A --> N1");
    expect(detectDiagramKind(out)).toBe("flowchart");
  });

  it("编号避开已占用的 N1", () => {
    const out = appendNode("flowchart TD\n  A[N1] --> N1[已有]");
    expect(out).toContain("N2[新节点]");
  });

  it("无锚点的空图只追加节点声明", () => {
    const out = appendNode("flowchart TD");
    expect(out).toContain("N1[新节点]");
    expect(out).not.toContain("--> N1");
  });

  it("非 flowchart → 原样返回", () => {
    expect(appendNode(STATE)).toBe(STATE);
  });

  it("结果仍可被格式化（语法未被破坏）", () => {
    expect(formatDiagram(appendNode(FLOW))).toContain("N1[新节点]");
  });
});

describe("appendState（stateDiagram）", () => {
  it("从首个状态连到新状态", () => {
    const out = appendState(STATE);
    expect(out).toContain("空工作区 --> 新状态1");
    expect(detectDiagramKind(out)).toBe("state");
  });

  it("编号避开已占用的新状态1", () => {
    const out = appendState("stateDiagram-v2\n  [*] --> 新状态1");
    expect(out).toContain("新状态1 --> 新状态2");
  });

  it("无锚点 → 用 state 声明（裸标识符在状态图里非法）", () => {
    const out = appendState("stateDiagram-v2");
    expect(out).toContain("state 新状态1");
  });

  it("非状态图 → 原样返回", () => {
    expect(appendState(FLOW)).toBe(FLOW);
  });
});
