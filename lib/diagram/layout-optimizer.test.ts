import { describe, it, expect } from "vitest";
import {
  changeDiagramDirection,
  detectDiagramDirection,
  optimizeDiagramLayout,
} from "./layout-optimizer";

describe("detectDiagramDirection", () => {
  it("识别 flowchart / graph 的方向", () => {
    expect(detectDiagramDirection("flowchart TD\n  A --> B")).toBe("TD");
    expect(detectDiagramDirection("graph LR\n  A --> B")).toBe("LR");
    expect(detectDiagramDirection("flowchart  RL\n  A --> B")).toBe("RL");
  });

  it("非 flowchart / 无方向 → null", () => {
    expect(detectDiagramDirection("stateDiagram-v2\n  A --> B")).toBeNull();
    expect(detectDiagramDirection("A --> B")).toBeNull();
    expect(detectDiagramDirection("")).toBeNull();
  });
});

describe("changeDiagramDirection", () => {
  it("改写声明行的方向，保留关键字与正文", () => {
    expect(changeDiagramDirection("flowchart TD\n  A --> B", "LR")).toBe(
      "flowchart LR\n  A --> B",
    );
    expect(changeDiagramDirection("graph LR\n  A --> B", "RL")).toBe(
      "graph RL\n  A --> B",
    );
    expect(changeDiagramDirection("flowchart TD\n  A --> B", "TB")).toBe(
      "flowchart TB\n  A --> B",
    );
  });

  it("多余空格的声明行被规整", () => {
    expect(changeDiagramDirection("flowchart    TD\n  A --> B", "LR")).toBe(
      "flowchart LR\n  A --> B",
    );
  });

  it("方向已相同 → 原样返回（幂等）", () => {
    const code = "flowchart LR\n  A --> B";
    expect(changeDiagramDirection(code, "LR")).toBe(code);
  });

  it("非 flowchart（状态图 / 时序图）/ 无声明 → 原样返回", () => {
    const state = "stateDiagram-v2\n  [*] --> A";
    expect(changeDiagramDirection(state, "LR")).toBe(state);
    const noHeader = "A --> B";
    expect(changeDiagramDirection(noHeader, "LR")).toBe(noHeader);
  });

  it("空 / 非字符串 → 空串，不抛错", () => {
    expect(changeDiagramDirection("", "LR")).toBe("");
    expect(changeDiagramDirection(null as unknown as string, "LR")).toBe("");
  });
});

describe("optimizeDiagramLayout", () => {
  it("规范化缩进与连线间距", () => {
    const out = optimizeDiagramLayout("flowchart TD\nA-->B\nB   -->   C");
    expect(out).toBe("flowchart TD\n  A --> B\n  B --> C");
  });

  it("保留边类型语义（-.-> / ==> / --- 不被改写）", () => {
    const out = optimizeDiagramLayout(
      "flowchart TD\nA-.->B\nB==>C\nC---D",
    );
    expect(out).toContain("A -.-> B");
    expect(out).toContain("B ==> C");
    expect(out).toContain("C --- D");
  });

  it("边标签前不插空格（保持 -->|标签| 的写法）", () => {
    const out = optimizeDiagramLayout("flowchart LR\nA-->|HTTPS| B");
    expect(out).toContain("A -->|HTTPS| B");
  });

  it("不触碰方括号标签内部的空格与破折号", () => {
    const out = optimizeDiagramLayout(
      "flowchart TD\nA[用户 登录]-->B[API--Gateway]",
    );
    expect(out).toContain("[用户 登录]");
    expect(out).toContain("[API--Gateway]");
  });

  it("状态图的转移说明与 [*] 保持原样", () => {
    const out = optimizeDiagramLayout(
      "stateDiagram-v2\n[*]-->待处理\n待处理-->已完成: 成功",
    );
    expect(out).toContain("[*] --> 待处理");
    expect(out).toContain("待处理 --> 已完成: 成功");
  });

  it("折叠空行、去掉首尾空行（沿用 formatDiagram 的既有语义：连续空行折叠为一）", () => {
    const out = optimizeDiagramLayout("\n\nflowchart TD\n\n\n  A --> B\n\n");
    expect(out).toBe("flowchart TD\n\n  A --> B");
  });

  it("幂等", () => {
    const once = optimizeDiagramLayout("flowchart TD\nA-.->B\n\nB-->C");
    expect(optimizeDiagramLayout(once)).toBe(once);
  });

  it("空 / 非字符串 → 空串，不抛错", () => {
    expect(optimizeDiagramLayout("")).toBe("");
    expect(optimizeDiagramLayout(undefined as unknown as string)).toBe("");
  });
});
