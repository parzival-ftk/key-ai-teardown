import { describe, it, expect } from "vitest";
import {
  diffReports,
  diffTextLines,
  type DiffReport,
  type DiffReportSection,
} from "./report-diff";

/**
 * W21 · 报告 Diff 引擎单测。
 *
 * 两层判据：
 *  1) 行级 diff 必须是**真 LCS**（不把「改一行」退化成「删 N 行 + 增 N 行」），且行号可回溯；
 *  2) 段落级四态（added / removed / modified / unchanged）与各类附属差异（Mermaid、维度分、置信度）
 *     必须分类准确；空/缺字段一律不抛错。
 */

const text = (...lines: string[]) => lines.join("\n");

describe("diffTextLines（行级 LCS）", () => {
  it("完全相同 → 全 unchanged，两侧行号对齐", () => {
    const t = text("a", "b", "c");
    expect(diffTextLines(t, t)).toEqual([
      { type: "unchanged", text: "a", baseLine: 1, compareLine: 1 },
      { type: "unchanged", text: "b", baseLine: 2, compareLine: 2 },
      { type: "unchanged", text: "c", baseLine: 3, compareLine: 3 },
    ]);
  });

  it("尾部新增 → added，只有 compare 侧行号", () => {
    expect(diffTextLines(text("a", "b"), text("a", "b", "c"))).toEqual([
      { type: "unchanged", text: "a", baseLine: 1, compareLine: 1 },
      { type: "unchanged", text: "b", baseLine: 2, compareLine: 2 },
      { type: "added", text: "c", baseLine: null, compareLine: 3 },
    ]);
  });

  it("中间删除 → removed，只有 base 侧行号，后续行号不串位", () => {
    expect(diffTextLines(text("a", "b", "c"), text("a", "c"))).toEqual([
      { type: "unchanged", text: "a", baseLine: 1, compareLine: 1 },
      { type: "removed", text: "b", baseLine: 2, compareLine: null },
      { type: "unchanged", text: "c", baseLine: 3, compareLine: 2 },
    ]);
  });

  it("改一行 → 一条 removed + 一条 added（不是整段删增）", () => {
    const diff = diffTextLines(text("a", "b", "c"), text("a", "X", "c"));
    expect(diff).toEqual([
      { type: "unchanged", text: "a", baseLine: 1, compareLine: 1 },
      { type: "removed", text: "b", baseLine: 2, compareLine: null },
      { type: "added", text: "X", baseLine: null, compareLine: 2 },
      { type: "unchanged", text: "c", baseLine: 3, compareLine: 3 },
    ]);
  });

  it("LCS 最优性：不会把可保留的行误判为删+增", () => {
    // a b c  →  a x c ：只有 b→x 一处变化
    const diff = diffTextLines(text("a", "b", "c"), text("a", "x", "c"));
    expect(diff.filter((l) => l.type === "removed")).toHaveLength(1);
    expect(diff.filter((l) => l.type === "added")).toHaveLength(1);
    expect(diff.filter((l) => l.type === "unchanged")).toHaveLength(2);
  });

  it("空串与单侧为空", () => {
    expect(diffTextLines("", "")).toEqual([]);
    expect(diffTextLines("", text("a"))).toEqual([
      { type: "added", text: "a", baseLine: null, compareLine: 1 },
    ]);
    expect(diffTextLines(text("a"), "")).toEqual([
      { type: "removed", text: "a", baseLine: 1, compareLine: null },
    ]);
  });

  it("大文本（前缀/后缀裁剪后仍正确）：100 行只改第 50 行", () => {
    const baseLines = Array.from({ length: 100 }, (_, i) => `L${i + 1}`);
    const compareLines = [...baseLines];
    compareLines[49] = "CHANGED";
    const diff = diffTextLines(baseLines.join("\n"), compareLines.join("\n"));

    expect(diff.filter((l) => l.type === "added")).toHaveLength(1);
    expect(diff.filter((l) => l.type === "removed")).toHaveLength(1);
    expect(diff.filter((l) => l.type === "unchanged")).toHaveLength(99);
    // 被替换的那一行两侧行号都应是 50
    expect(diff.find((l) => l.text === "CHANGED")).toMatchObject({
      type: "added",
      compareLine: 50,
    });
    expect(diff.find((l) => l.text === "L50")).toMatchObject({
      type: "removed",
      baseLine: 50,
    });
  });

  it("确定性：同一输入两次结果一致", () => {
    const a = diffTextLines(text("a", "b"), text("a", "c"));
    const b = diffTextLines(text("a", "b"), text("a", "c"));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// —— 段落级 ——

const section = (
  agentId: string,
  output: string,
  extra: Partial<DiffReportSection> = {},
): DiffReportSection => ({ agentId, name: agentId.toUpperCase(), output, ...extra });

const report = (sections: DiffReportSection[]): DiffReport => ({
  name: "R",
  sections,
});

describe("diffReports（段落四态）", () => {
  it("分类 added / removed / modified / unchanged，并给出汇总", () => {
    const base = report([
      section("market", text("A", "B")),
      section("prd", "P"),
      section("synthesis", "S"),
    ]);
    const compare = report([
      section("market", text("A", "B")),
      section("prd", "P2"),
      section("newcomer", "N"),
    ]);

    const result = diffReports(base, compare);
    const byId = Object.fromEntries(result.sections.map((s) => [s.agentId, s]));

    expect(byId.market.status).toBe("unchanged");
    expect(byId.prd.status).toBe("modified");
    expect(byId.synthesis.status).toBe("removed");
    expect(byId.newcomer.status).toBe("added");

    expect(result.summary).toEqual({
      added: 1,
      removed: 1,
      modified: 1,
      unchanged: 1,
    });
    expect(result.hasChanges).toBe(true);
  });

  it("完全一致 → 无变更", () => {
    const r = report([section("a", "x"), section("b", "y")]);
    const result = diffReports(r, r);
    expect(result.hasChanges).toBe(false);
    expect(result.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 2,
    });
    expect(result.sections.every((s) => s.status === "unchanged")).toBe(true);
  });

  it("段落顺序：以 base 顺序为准，新增段追加在后", () => {
    const base = report([section("b", "1"), section("a", "2")]);
    const compare = report([section("a", "2"), section("b", "1"), section("zz", "3")]);
    expect(diffReports(base, compare).sections.map((s) => s.agentId)).toEqual([
      "b",
      "a",
      "zz",
    ]);
  });

  it("removed 段的 diff 行全为 removed；added 段全为 added", () => {
    const result = diffReports(
      report([section("old", text("x", "y"))]),
      report([section("fresh", text("p", "q"))]),
    );
    const old = result.sections.find((s) => s.agentId === "old")!;
    const fresh = result.sections.find((s) => s.agentId === "fresh")!;
    expect(old.lines.map((l) => l.type)).toEqual(["removed", "removed"]);
    expect(fresh.lines.map((l) => l.type)).toEqual(["added", "added"]);
  });

  it("段落名缺省时回退为 agentId", () => {
    const result = diffReports(
      { sections: [{ agentId: "solo", output: "x" }] },
      { sections: [{ agentId: "solo", output: "x" }] },
    );
    expect(result.sections[0].name).toBe("solo");
  });
});

describe("diffReports（Mermaid 图谱差异）", () => {
  const withDiagram = (code: string) => text("说明", "```mermaid", code, "```");

  it("同一位置的图谱内容变化 → modified，两版源码都带出", () => {
    const result = diffReports(
      report([section("prd", withDiagram("flowchart TD\n  A --> B"))]),
      report([section("prd", withDiagram("flowchart TD\n  A --> C"))]),
    );
    const mermaid = result.sections[0].mermaid;
    expect(mermaid).toHaveLength(1);
    expect(mermaid[0].status).toBe("modified");
    expect(mermaid[0].baseCode).toContain("A --> B");
    expect(mermaid[0].compareCode).toContain("A --> C");
  });

  it("图谱新增 / 移除 / 未变", () => {
    const added = diffReports(
      report([section("prd", "无图")]),
      report([section("prd", withDiagram("flowchart TD\n  A --> B"))]),
    );
    expect(added.sections[0].mermaid[0].status).toBe("added");
    expect(added.sections[0].mermaid[0].baseCode).toBeNull();

    const removed = diffReports(
      report([section("prd", withDiagram("flowchart TD\n  A --> B"))]),
      report([section("prd", "无图")]),
    );
    expect(removed.sections[0].mermaid[0].status).toBe("removed");
    expect(removed.sections[0].mermaid[0].compareCode).toBeNull();

    const same = diffReports(
      report([section("prd", withDiagram("flowchart TD\n  A --> B"))]),
      report([section("prd", withDiagram("flowchart TD\n  A --> B"))]),
    );
    expect(same.sections[0].mermaid[0].status).toBe("unchanged");
  });

  it("没有图谱时 mermaid 为空数组", () => {
    const result = diffReports(report([section("a", "纯文本")]), report([section("a", "纯文本")]));
    expect(result.sections[0].mermaid).toEqual([]);
  });
});

describe("diffReports（竞品维度分与置信度）", () => {
  it("维度分变化 → 该段为 modified，并给出逐维度 Δ", () => {
    const result = diffReports(
      report([section("market", "正文", { dimensionScores: { ux: 80, growth: 60 } })]),
      report([section("market", "正文", { dimensionScores: { ux: 90, growth: 50 } })]),
    );
    const s = result.sections[0];
    expect(s.status).toBe("modified");
    expect(s.dimensionDeltas).toEqual([
      { id: "ux", label: "UI / UX", base: 80, compare: 90, delta: 10 },
      { id: "growth", label: "增长动能", base: 60, compare: 50, delta: -10 },
    ]);
  });

  it("单侧缺失维度分时按 null 计入", () => {
    const result = diffReports(
      report([section("market", "正文")]),
      report([section("market", "正文", { dimensionScores: { ux: 70 } })]),
    );
    expect(result.sections[0].dimensionDeltas).toEqual([
      { id: "ux", label: "UI / UX", base: null, compare: 70, delta: null },
    ]);
    expect(result.sections[0].status).toBe("modified");
  });

  it("两侧都没有维度分时 dimensionDeltas 为空", () => {
    const result = diffReports(report([section("a", "文本")]), report([section("a", "文本")]));
    expect(result.sections[0].dimensionDeltas).toEqual([]);
  });

  it("置信度变化单独暴露，不把内容未变的段落标成 modified", () => {
    const result = diffReports(
      report([section("a", "同样的正文", { confidence: 80 })]),
      report([section("a", "同样的正文", { confidence: 90 })]),
    );
    expect(result.sections[0].status).toBe("unchanged");
    expect(result.sections[0].confidenceDelta).toBe(10);
  });

  it("缺省置信度 → confidenceDelta 为 null", () => {
    const result = diffReports(report([section("a", "x")]), report([section("a", "x")]));
    expect(result.sections[0].confidenceDelta).toBeNull();
  });
});

describe("diffReports（边界安全）", () => {
  it("空对象 / 缺 sections → 空结果，不抛错", () => {
    expect(() => diffReports({}, {})).not.toThrow();
    const result = diffReports({}, {});
    expect(result.sections).toEqual([]);
    expect(result.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 0,
    });
    expect(result.hasChanges).toBe(false);
  });

  it("段落缺 output 字段 → 按空串处理", () => {
    const result = diffReports(
      { sections: [{ agentId: "a" }] },
      { sections: [{ agentId: "a", output: "新内容" }] },
    );
    expect(result.sections[0].status).toBe("modified");
    expect(result.sections[0].lines).toEqual([
      { type: "added", text: "新内容", baseLine: null, compareLine: 1 },
    ]);
  });

  it("非数组 sections → 按空处理", () => {
    expect(() =>
      diffReports({ sections: "boom" as never }, { sections: null as never }),
    ).not.toThrow();
    expect(diffReports({ sections: "boom" as never }, {}).sections).toEqual([]);
  });

  it("报告名缺省时回退为空串", () => {
    const result = diffReports({}, {});
    expect(result.baseName).toBe("");
    expect(result.compareName).toBe("");
  });

  it("确定性：同一输入两次结果一致", () => {
    const base = report([section("a", text("x", "y"))]);
    const compare = report([section("a", text("x", "z"))]);
    expect(JSON.stringify(diffReports(base, compare))).toBe(
      JSON.stringify(diffReports(base, compare)),
    );
  });
});
