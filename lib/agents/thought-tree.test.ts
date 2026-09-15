import { describe, it, expect } from "vitest";
import { parseReasoningTrace } from "./reasoning-parser";
import {
  buildThoughtTree,
  flattenThoughtTree,
  THOUGHT_KIND_LABEL,
  type ThoughtTreeNode,
} from "./thought-tree";

const stepsOf = (log: string) => parseReasoningTrace(log);

const PARALLEL_LOG = [
  "MarketAgent:",
  "Thought: **没有统一心智就没有对比**。",
  "Observation: 识别 4 个竞品，耗时 1.1s",
  "",
  "PrdAgent:",
  "Thought: **每条用户故事都要挂回一条质疑**。",
  'Action: draft_prd("模板中心")',
  "",
  "RebuttalAgent:",
  "Thought: 结论：模板生态可能是伪壁垒。",
].join("\n");

const DEBATE_LOG = [
  "PrdAgent:",
  "Thought: 初版方案。",
  "",
  "RebuttalAgent:",
  "Thought: 这里站不住脚。",
  "",
  "PrdAgent:",
  "Thought: 已修正，补充边界条件。",
].join("\n");

describe("buildThoughtTree：安全降级", () => {
  it("空步骤 → 仅根节点，不抛错", () => {
    const tree = buildThoughtTree([]);
    expect(tree.root.kind).toBe("root");
    expect(tree.root.children).toEqual([]);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.linear).toBe(true);
    expect(tree.counts).toEqual({
      root: 1,
      branch: 0,
      conflict: 0,
      decision: 0,
      "human-intervention": 0,
    });
  });

  it("非法输入（null / 非数组）→ 退化为仅根节点，不抛错", () => {
    const a = buildThoughtTree(null as unknown as never);
    const b = buildThoughtTree(undefined as unknown as never);
    expect(a.root.kind).toBe("root");
    expect(b.nodes).toHaveLength(1);
  });
});

describe("buildThoughtTree：树状结构", () => {
  const tree = buildThoughtTree(stepsOf(PARALLEL_LOG));

  it("独立分析 Agent 成为根下的并列分支", () => {
    expect(tree.root.children.map((n) => n.agentId)).toEqual(["market", "prd"]);
    expect(tree.root.children.every((n) => n.kind === "branch")).toBe(true);
    expect(tree.linear).toBe(false);
  });

  it("反驳 Agent 挂到它所质疑的分支之下（conflict）", () => {
    const prd = tree.root.children.find((n) => n.agentId === "prd")!;
    expect(prd.children).toHaveLength(1);
    expect(prd.children[0].agentId).toBe("rebuttal");
    expect(prd.children[0].kind).toBe("conflict");
  });

  it("节点聚合步骤 index 与耗时", () => {
    const market = tree.root.children[0];
    expect(market.stepIndexes).toEqual([0, 1]);
    expect(market.durationMs).toBe(1100);
    const rebuttal = tree.root.children[1].children[0];
    expect(rebuttal.stepIndexes).toEqual([4]);
    expect(rebuttal.durationMs).toBeUndefined();
  });

  it("节点标题取自关键断言，正文含各步骤内容", () => {
    const market = tree.root.children[0];
    expect(market.title).toBe("没有统一心智就没有对比");
    expect(market.detail).toContain("识别 4 个竞品");
  });

  it("known Agent 带报告锚点；未知 Agent 无锚点", () => {
    expect(tree.root.children[0].reportAnchor).toBe("section-market");
    expect(tree.root.children[1].reportAnchor).toBe("section-prd");
    const unknown = buildThoughtTree(
      stepsOf("UnknownAgent:\nThought: 独立观察。"),
    );
    expect(unknown.nodes[1].reportAnchor).toBeUndefined();
  });

  it("counts 之和等于节点总数；flatten 为前序 DFS", () => {
    const counts = tree.counts;
    expect(
      counts.root +
        counts.branch +
        counts.conflict +
        counts.decision +
        counts["human-intervention"],
    ).toBe(tree.nodes.length);
    expect(flattenThoughtTree(tree.root).map((n) => n.agentId)).toEqual([
      undefined,
      "market",
      "prd",
      "rebuttal",
    ]);
  });
});

describe("buildThoughtTree：辩论链（主推导 → 质疑 → 修正）", () => {
  const tree = buildThoughtTree(stepsOf(DEBATE_LOG));

  it("质疑收敛为结论节点，且挂在 conflict 之下", () => {
    expect(tree.root.children).toHaveLength(1);
    const prd0 = tree.root.children[0];
    expect(prd0.agentId).toBe("prd");
    expect(prd0.kind).toBe("branch");

    const conflict = prd0.children[0];
    expect(conflict.kind).toBe("conflict");
    expect(conflict.agentId).toBe("rebuttal");

    const decision = conflict.children[0];
    expect(decision.kind).toBe("decision");
    expect(decision.agentId).toBe("prd");
  });

  it("纯链式结构标记为线性（无分叉）", () => {
    expect(tree.linear).toBe(true);
    expect(tree.counts.conflict).toBe(1);
    expect(tree.counts.decision).toBe(1);
  });
});

describe("buildThoughtTree：线性树干退化", () => {
  it("单一 Agent 的多步骤 → 逐步串联的树干", () => {
    const tree = buildThoughtTree(
      stepsOf(
        [
          "PrdAgent:",
          "Thought: 第一步。",
          "Action: step_one()",
          "Observation: 完成，耗时 300ms",
        ].join("\n"),
      ),
    );
    expect(tree.linear).toBe(true);
    expect(tree.nodes).toHaveLength(4); // root + 3 steps
    const n1 = tree.root.children[0];
    const n2 = n1.children[0];
    const n3 = n2.children[0];
    expect(n1.agentId).toBe("prd");
    expect(n1.agentLabel).toBe("PrdAgent");
    expect(n1.stepIndexes).toEqual([0]);
    expect(n1.reportAnchor).toBe("section-prd");
    expect(n3.durationMs).toBe(300);
    expect(n3.detail).toContain("完成");
  });

  it("无 Agent 标签但含质疑措辞的步骤被识别为 conflict", () => {
    const tree = buildThoughtTree(
      stepsOf("Thought: 但是，这个假设站不住脚，存在明显漏洞。"),
    );
    expect(tree.nodes[1].kind).toBe("conflict");
  });
});

describe("THOUGHT_KIND_LABEL", () => {
  it("节点类型均有中文标签", () => {
    const kinds: ThoughtTreeNode["kind"][] = [
      "root",
      "branch",
      "conflict",
      "decision",
    ];
    for (const k of kinds) expect(THOUGHT_KIND_LABEL[k]).toBeTruthy();
  });
});
