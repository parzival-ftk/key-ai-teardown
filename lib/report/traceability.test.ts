import { describe, it, expect } from "vitest";
import {
  buildTraceability,
  criticAnchorId,
  extractCriticItems,
  extractPrdReferences,
  prdAnchorId,
} from "./traceability";

const CRITIC = [
  "### 被质疑的假设",
  "C1. 「block 模型壁垒高」——模板可复制，壁垒可能被抹平。",
  "**C2.** 「掌控感是核心情绪价值」——也可能是工具焦虑的来源。",
  "C3、中文市场的社区供给能否跟上，缺乏数据。",
].join("\n");

describe("extractCriticItems", () => {
  it("解析行首编号，容忍列表符号 / 粗体 / 全角分隔符", () => {
    const items = extractCriticItems(CRITIC);
    expect(items.map((i) => i.id)).toEqual(["C1", "C2", "C3"]);
    expect(items[0].text).toContain("block 模型壁垒高");
    expect(items[0].text).not.toContain("C1");
  });

  it("归一化为大写 id，且不重复", () => {
    const items = extractCriticItems("c1. 甲\nC1. 重复\nC2. 乙");
    expect(items.map((i) => i.id)).toEqual(["C1", "C2"]);
  });

  it("正文中提及编号不算条目（只认行首）", () => {
    const items = extractCriticItems("我们已在 C1 里讨论过这个假设。");
    expect(items).toEqual([]);
  });

  it("空文本 → 空数组", () => {
    expect(extractCriticItems("")).toEqual([]);
  });
});

describe("extractPrdReferences", () => {
  it("提取 [Cn] 标记并保留所在行上下文", () => {
    const refs = extractPrdReferences(
      "### 用户故事\n- As a 新用户 [C1] 选择模板即可开始\n- 邀请成员 [C2][C3]",
    );
    expect(refs.map((r) => r.criticId)).toEqual(["C1", "C2", "C3"]);
    expect(refs[0].line).toContain("As a 新用户");
  });

  it("小写标记也能识别", () => {
    expect(extractPrdReferences("段落 [c2]").map((r) => r.criticId)).toEqual([
      "C2",
    ]);
  });

  it("无标记 → 空数组", () => {
    expect(extractPrdReferences("普通 PRD 正文")).toEqual([]);
  });
});

describe("buildTraceability", () => {
  it("建立双向关联并统计覆盖", () => {
    const report = buildTraceability(
      CRITIC,
      "### 用户故事\n- 模板一键开始 [C1]\n- 团队邀请 [C2]",
    );
    expect(report.total).toBe(3);
    expect(report.addressed).toBe(2);
    expect(report.unaddressed).toEqual(["C3"]);
    expect(report.links[0]).toMatchObject({ criticId: "C1", addressed: true });
    expect(report.links[0].references).toHaveLength(1);
    expect(report.links[2]).toMatchObject({ criticId: "C3", addressed: false });
  });

  it("元数据声明也算已回应（正文漏标记时的兜底）", () => {
    const report = buildTraceability(CRITIC, "没有标记的 PRD", ["C1", "C3"]);
    expect(report.addressed).toBe(2);
    expect(report.unaddressed).toEqual(["C2"]);
    expect(report.links[0].references).toEqual([]);
  });

  it("悬空引用（PRD 引用了不存在的质疑）被单列", () => {
    const report = buildTraceability(CRITIC, "正文 [C1] 与 [C9]");
    expect(report.danglingReferences).toEqual(["C9"]);
  });

  it("无质疑条目 → 全空但不崩", () => {
    const report = buildTraceability("", "");
    expect(report).toEqual({
      links: [],
      total: 0,
      addressed: 0,
      unaddressed: [],
      danglingReferences: [],
    });
  });
});

describe("DOM 锚点 id", () => {
  it("大小写归一，质疑与 PRD 前缀不同", () => {
    expect(criticAnchorId("c1")).toBe("critic-c1");
    expect(criticAnchorId("C1")).toBe("critic-c1");
    expect(prdAnchorId("C2")).toBe("prd-ref-c2");
  });
});
