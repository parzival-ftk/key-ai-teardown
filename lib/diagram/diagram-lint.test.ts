import { describe, it, expect } from "vitest";
import { diagnoseMermaid, hasBlockingDiagnostic } from "./diagram-lint";

/**
 * W19 · Mermaid 启发式诊断单测。
 * 判据：合法源码**零误报**（宁可漏报）；结构性错误必须带行号。
 */

const FLOW = "flowchart TD\n  A[进入] --> B[选模板]";
const STATE = "stateDiagram-v2\n  [*] --> 空工作区\n  空工作区 --> 已选模板";

describe("diagnoseMermaid（合法源码不误报）", () => {
  it("合法 flowchart → 无诊断", () => {
    expect(diagnoseMermaid(FLOW)).toEqual([]);
  });

  it("合法 stateDiagram → 无诊断", () => {
    expect(diagnoseMermaid(STATE)).toEqual([]);
  });

  it("标签文本里含括号不误报", () => {
    expect(diagnoseMermaid('flowchart TD\n  A["开始 (可选)"] --> B[结束]')).toEqual([]);
  });

  it("前置注释行不影响声明判定", () => {
    expect(diagnoseMermaid("%% 说明\n%% 又一行\nflowchart LR\n  A --> B")).toEqual([]);
  });
});

describe("diagnoseMermaid（结构性错误）", () => {
  it("空源码 → error，且不指向具体行", () => {
    const ds = diagnoseMermaid("   \n\n ");
    expect(ds).toHaveLength(1);
    expect(ds[0].severity).toBe("error");
    expect(ds[0].message).toContain("为空");
    expect(ds[0].line).toBeNull();
  });

  it("缺少图形声明 → error 并给出首行行号", () => {
    const ds = diagnoseMermaid("  A --> B\n  B --> C");
    const d = ds.find((x) => x.message.includes("缺少图形声明"));
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.line).toBe(1);
  });

  it("声明前的注释/空行不影响其行号", () => {
    const ds = diagnoseMermaid("\n%% 注释\nA --> B");
    expect(ds.find((x) => x.message.includes("缺少图形声明"))?.line).toBe(3);
  });

  it("方括号不配对 → error 带行号", () => {
    const ds = diagnoseMermaid("flowchart TD\n  A[进入 --> B");
    const d = ds.find((x) => x.message.includes("方括号"));
    expect(d?.severity).toBe("error");
    expect(d?.line).toBe(2);
  });

  it("圆括号不配对 → error", () => {
    const ds = diagnoseMermaid("flowchart TD\n  A(进入 --> B");
    expect(ds.some((x) => x.message.includes("圆括号"))).toBe(true);
  });

  it("双引号未闭合 → error", () => {
    const ds = diagnoseMermaid('flowchart TD\n  A["开始] --> B');
    expect(ds.some((x) => x.message.includes("双引号未闭合"))).toBe(true);
  });

  it("围栏残留 → warning（非阻断）", () => {
    const ds = diagnoseMermaid("```mermaid\nflowchart TD\n A --> B\n```");
    const w = ds.find((x) => x.message.includes("```"));
    expect(w?.severity).toBe("warning");
    expect(hasBlockingDiagnostic(ds)).toBe(false);
  });
});

describe("hasBlockingDiagnostic", () => {
  it("有 error 时为 true，仅 warning 时为 false", () => {
    expect(hasBlockingDiagnostic([])).toBe(false);
    expect(
      hasBlockingDiagnostic([{ severity: "warning", line: null, message: "w" }]),
    ).toBe(false);
    expect(
      hasBlockingDiagnostic([{ severity: "error", line: 1, message: "e" }]),
    ).toBe(true);
  });
});
