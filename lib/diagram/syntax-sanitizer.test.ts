import { describe, it, expect } from "vitest";
import { sanitizeMermaidSyntax } from "./syntax-sanitizer";
import { diagnoseMermaid, hasBlockingDiagnostic } from "./diagram-lint";

describe("sanitizeMermaidSyntax：容错入口", () => {
  it("空 / 非字符串 → 空结果，不抛错", () => {
    for (const input of ["", "   ", null, undefined, 42]) {
      const r = sanitizeMermaidSyntax(input as unknown as string);
      expect(r.fixedCode).toBe("");
      expect(r.isFixed).toBe(false);
      expect(r.fixLogs).toEqual([]);
    }
  });

  it("本来就合法 → isFixed=false 且逐字不变", () => {
    const code = "flowchart LR\n  A[用户] --> B[服务]";
    const r = sanitizeMermaidSyntax(code);
    expect(r.isFixed).toBe(false);
    expect(r.fixedCode).toBe(code);
    expect(r.fixLogs).toEqual([]);
  });
});

describe("sanitizeMermaidSyntax：补全图表类型头", () => {
  it("缺少声明 → 补 flowchart TD 并记日志", () => {
    const r = sanitizeMermaidSyntax("A[用户] --> B[服务]");
    expect(r.fixedCode.startsWith("flowchart TD")).toBe(true);
    expect(r.fixedCode).toContain("A[用户] --> B[服务]");
    expect(r.isFixed).toBe(true);
    expect(r.fixLogs.join(" ")).toContain("图表类型头");
  });

  it("以注释开头时仍能识别缺失声明（注释保留在最前）", () => {
    const r = sanitizeMermaidSyntax("%% 说明\nA --> B");
    expect(r.fixedCode.startsWith("%% 说明")).toBe(true);
    expect(r.fixedCode).toContain("flowchart TD");
  });

  it("已有 graph LR 声明不重复补", () => {
    const r = sanitizeMermaidSyntax("graph LR\n  A --> B");
    expect(r.fixedCode.match(/flowchart|graph/g)?.length).toBe(1);
    expect(r.isFixed).toBe(false);
  });
});

describe("sanitizeMermaidSyntax：纠正 Sequence 边符号", () => {
  it("flowchart 中的 ->> / -->> 转为 -->", () => {
    const r = sanitizeMermaidSyntax("flowchart TD\n  A ->> B\n  B -->> C");
    expect(r.fixedCode).toContain("A --> B");
    expect(r.fixedCode).toContain("B --> C");
    expect(r.fixedCode).not.toContain("->>");
    expect(r.fixLogs.join(" ")).toContain("->>");
  });

  it("sequenceDiagram 里的 ->> 是合法的，不得改动", () => {
    const code = "sequenceDiagram\n  A->>B: hi\n  B-->>A: ok";
    const r = sanitizeMermaidSyntax(code);
    expect(r.fixedCode).toContain("A->>B: hi");
    expect(r.isFixed).toBe(false);
  });
});

describe("sanitizeMermaidSyntax：规范化节点声明", () => {
  it("裸中文节点 → 生成 ASCII id 并把中文包进方括号", () => {
    const r = sanitizeMermaidSyntax("flowchart TD\n  用户 --> 首页");
    expect(r.fixedCode).toContain("N1[用户] --> N2[首页]");
    expect(r.fixedCode).not.toContain("用户 -->");
    expect(r.fixLogs.length).toBeGreaterThan(0);
  });

  it("同一节点的多处引用重命名一致（不产生断链）", () => {
    const r = sanitizeMermaidSyntax("flowchart TD\n  用户 --> 首页\n  首页 --> 用户");
    const ids = r.fixedCode.match(/\bN\d+\b/g) ?? [];
    expect(new Set(ids).size).toBe(2);
    // 首次出现带标签，后续引用复用同一 id
    expect(r.fixedCode).toContain("N1[用户]");
    expect(r.fixedCode).toContain("N2[首页]");
  });

  it("带括号但 id 含空格/特殊符号 → 纯化为字母数字下划线", () => {
    const r = sanitizeMermaidSyntax(
      "flowchart TD\n  Node 1[用户] --> Node-2[服务]",
    );
    expect(r.fixedCode).not.toContain("Node 1");
    expect(r.fixedCode).toContain("[用户]");
    expect(r.fixedCode).toContain("[服务]");
    expect(r.fixedCode).toMatch(/N\d+\[用户\]/);
  });

  it("不触碰方括号标签内部的中文与空格", () => {
    const r = sanitizeMermaidSyntax("flowchart TD\n  A[用户 登录 页面] --> B[首页]");
    expect(r.fixedCode).toContain("[用户 登录 页面]");
    expect(r.fixedCode).toContain("A[");
  });

  it("subgraph / classDef / 注释行保持原样", () => {
    const r = sanitizeMermaidSyntax(
      [
        "flowchart TD",
        "  %% 注释 保留空格",
        "  subgraph 我的 系统",
        "    A[用户] --> B[服务]",
        "  end",
      ].join("\n"),
    );
    expect(r.fixedCode).toContain("%% 注释 保留空格");
    expect(r.fixedCode).toContain("subgraph 我的 系统");
  });
});

describe("sanitizeMermaidSyntax：清理空行与悬空连线", () => {
  it("折叠多余空行、去掉首尾空行", () => {
    const r = sanitizeMermaidSyntax("flowchart TD\n\n\n  A --> B\n\n\n");
    expect(r.fixedCode).toBe("flowchart TD\n  A --> B");
    expect(r.fixLogs.join(" ")).toContain("空行");
  });

  it("行尾悬空连接符 → 去掉箭头，保留节点", () => {
    const r = sanitizeMermaidSyntax("flowchart TD\n  A[用户] --> B[服务]\n  B -->");
    expect(r.fixedCode).toContain("  B");
    expect(r.fixedCode.trimEnd().endsWith("-->")).toBe(false);
    expect(r.fixLogs.join(" ")).toContain("悬空");
  });

  it("只有悬空箭头的行整行丢弃", () => {
    const r = sanitizeMermaidSyntax("flowchart TD\n  A --> B\n  -->");
    expect(r.fixedCode).not.toContain("--> \n");
    expect(r.fixedCode.split("\n")).toHaveLength(2);
  });
});

describe("sanitizeMermaidSyntax：不变量", () => {
  it("幂等：对已修补结果再跑一次不再产生修改", () => {
    const once = sanitizeMermaidSyntax("用户 ->> 首页\n\n\n  Node 1[服务] -->");
    const twice = sanitizeMermaidSyntax(once.fixedCode);
    expect(twice.fixedCode).toBe(once.fixedCode);
    expect(twice.isFixed).toBe(false);
  });

  it("修补结果通过项目自身的图谱诊断（无阻断性问题）", () => {
    const samples = [
      "A[用户] --> B[服务]",
      "flowchart TD\n  用户 --> 首页",
      "flowchart TD\n  A ->> B\n  B -->",
      "flowchart TD\n  Node 1[登录 页面] --> Node-2[首页]",
    ];
    for (const sample of samples) {
      const { fixedCode } = sanitizeMermaidSyntax(sample);
      expect(hasBlockingDiagnostic(diagnoseMermaid(fixedCode))).toBe(false);
    }
  });
});
