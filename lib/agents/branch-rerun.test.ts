import { describe, it, expect } from "vitest";
import { parseReasoningTrace } from "./reasoning-parser";
import { buildThoughtTree } from "./thought-tree";
import {
  MAIN_BRANCH_ID,
  prepareBranchRerun,
  createInterventionBranch,
  createMainBranch,
  buildSectionOverrides,
  nextBranchId,
  summarizeInstruction,
} from "./branch-rerun";

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

const steps = parseReasoningTrace(PARALLEL_LOG);
const tree = buildThoughtTree(steps);

const nodeIdOf = (agent: string) =>
  tree.nodes.find((n) => n.agentId === agent)!.id;
const PRD_ID = nodeIdOf("prd");
const REBUTTAL_ID = nodeIdOf("rebuttal");
const MARKET_ID = nodeIdOf("market");

describe("nextBranchId / summarizeInstruction", () => {
  it("从 main 派生 branch-1、branch-2，且复用空缺", () => {
    expect(nextBranchId([MAIN_BRANCH_ID])).toBe("branch-1");
    expect(nextBranchId([MAIN_BRANCH_ID, "branch-1"])).toBe("branch-2");
    expect(nextBranchId([MAIN_BRANCH_ID, "branch-2"])).toBe("branch-1");
    expect(nextBranchId([])).toBe("branch-1");
  });

  it("指令摘要超长截断", () => {
    expect(summarizeInstruction("补充 GDPR 验收标准")).toBe("补充 GDPR 验收标准");
    expect(summarizeInstruction("")).toBe("分支重算");
    const long = summarizeInstruction("一".repeat(60), 10);
    expect(long.length).toBe(11); // 10 + 省略号
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("prepareBranchRerun", () => {
  const payload = prepareBranchRerun(tree, PRD_ID, "补充 GDPR 验收标准", [
    MAIN_BRANCH_ID,
  ]);

  it("生成 branch-1，并记录干预点与 Agent", () => {
    expect(payload.found).toBe(true);
    expect(payload.branchId).toBe("branch-1");
    expect(payload.targetNodeId).toBe(PRD_ID);
    expect(payload.agentId).toBe("prd");
    expect(payload.instruction).toBe("补充 GDPR 验收标准");
  });

  it("保留干预点之前的历史路径（root，不含 target 自身）", () => {
    expect(payload.retainedNodes.map((n) => n.id)).toEqual([tree.root.id]);
    expect(payload.contextText).toContain("推理起点");
  });

  it("截断 target 及其后代，并列出需要重算的 Agent", () => {
    expect(payload.truncatedNodeIds).toContain(PRD_ID);
    expect(payload.truncatedNodeIds).toContain(REBUTTAL_ID);
    expect(payload.truncatedNodeIds).not.toContain(MARKET_ID);
    expect(payload.rerunAgentIds).toEqual(["prd", "rebuttal"]);
  });

  it("插入 human-intervention 节点，其下挂重算结果节点", () => {
    const node = payload.interventionNode;
    expect(node.kind).toBe("human-intervention");
    expect(node.detail).toContain("补充 GDPR 验收标准");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].kind).toBe("decision");
    expect(node.children[0].agentId).toBe("prd");
  });

  it("深层节点：保留完整父链", () => {
    const deep = prepareBranchRerun(tree, REBUTTAL_ID, "用数据回应", ["main"]);
    expect(deep.retainedNodes.map((n) => n.agentId)).toEqual([undefined, "prd"]);
    expect(deep.rerunAgentIds).toEqual(["rebuttal"]);
  });

  it("target 不存在 → found=false，不抛错", () => {
    const missing = prepareBranchRerun(tree, "no-such-node", "x", ["main"]);
    expect(missing.found).toBe(false);
    expect(missing.retainedNodes).toEqual([]);
    expect(missing.truncatedNodeIds).toEqual([]);
  });
});

describe("createInterventionBranch / materialize", () => {
  const branch = createInterventionBranch(
    tree,
    PRD_ID,
    "补充 GDPR 验收标准",
    [MAIN_BRANCH_ID],
  );

  it("分支 id/标签符合 main → branch-1 约定", () => {
    expect(branch.id).toBe("branch-1");
    expect(branch.label).toContain("分支 1");
    expect(branch.label).toContain("Intervened");
    expect(branch.instruction).toBe("补充 GDPR 验收标准");
  });

  it("分支树把干预点替换为 human-intervention（原子树被截断）", () => {
    const kinds = branch.tree.nodes.map((n) => n.kind);
    expect(kinds).toContain("human-intervention");
    expect(branch.tree.nodes.map((n) => n.agentId)).not.toContain("rebuttal");

    const rootChildren = branch.tree.root.children;
    expect(rootChildren).toHaveLength(2);
    expect(rootChildren[0].id).toBe(MARKET_ID); // 兄弟分支保留
    expect(rootChildren[1].kind).toBe("human-intervention");
  });

  it("深层干预：父链保留，干预节点插在 target 位置", () => {
    const deep = createInterventionBranch(tree, REBUTTAL_ID, "用数据回应", [
      "main",
      "branch-1",
    ]);
    expect(deep.id).toBe("branch-2");
    const prd = deep.tree.root.children.find((n) => n.agentId === "prd")!;
    expect(prd.children).toHaveLength(1);
    expect(prd.children[0].kind).toBe("human-intervention");
  });

  it("不改动原树（不可变性）", () => {
    expect(tree.root.children.map((n) => n.id)).toEqual([MARKET_ID, PRD_ID]);
    expect(tree.root.children[1].children.map((n) => n.id)).toEqual([
      REBUTTAL_ID,
    ]);
  });
});

describe("createMainBranch / buildSectionOverrides", () => {
  it("主分支 id 为 main，树即原始树", () => {
    const main = createMainBranch(steps);
    expect(main.id).toBe(MAIN_BRANCH_ID);
    expect(main.label).toContain("Main");
    expect(main.tree.nodes).toHaveLength(tree.nodes.length);
    expect(main.sectionOverrides).toEqual({});
  });

  it("按需重算的 Agent 生成章节覆盖，仅覆盖存在的章节", () => {
    const payload = prepareBranchRerun(tree, PRD_ID, "补充 GDPR 验收标准", [
      MAIN_BRANCH_ID,
    ]);
    const sections = [
      { agentId: "prd", output: "原始 PRD 正文" },
      { agentId: "market", output: "市场正文" },
    ];
    const overrides = buildSectionOverrides(sections, payload);
    expect(Object.keys(overrides)).toEqual(["prd"]);
    expect(overrides.prd).toContain("原始 PRD 正文");
    expect(overrides.prd).toContain("补充 GDPR 验收标准");
    expect(overrides.prd).toContain("人工干预");
  });
});
