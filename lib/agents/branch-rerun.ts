import {
  buildThoughtTree,
  summarizeTree,
  type ThoughtTreeResult,
  type ThoughtTreeNode,
} from "./thought-tree";
import type { ReasoningStep } from "./reasoning-parser";

/**
 * 分支干预（Human-in-the-loop）与局部重算引擎（W24）。
 *
 * 人在某一步上给出修正指令 → 截断该步及其下游 → 插入 `human-intervention` 节点 →
 * 派生一个新分支（`main` → `branch-1` → `branch-2` …），同一份报告下可挂多个平行分支。
 *
 * 纪律（沿用 W22/W23）：
 *   - 纯函数、不改动入参（原树保持不变，只克隆被替换的路径）；
 *   - **永不抛错** —— 干预点找不到时返回 `found: false` 的安全 payload。
 *
 * 「重算」在本模块里是**确定性的本地重建**：把干预约束落成结构节点与章节覆盖，
 * 供真实模型接入时替换（`BranchRerunPayload` 已备好 `contextText` / `rerunAgentIds` / 指令）。
 */

export const MAIN_BRANCH_ID = "main";

const CONSTRAINT_HEADER = "### 人工干预约束（Human-in-the-loop）";

export interface Branch {
  /** "main" | "branch-1" | "branch-2" … */
  id: string;
  /** 展示名，如 "主推理分支 (Main)" / "分支 1: 补充 GDPR 验收标准 (Intervened)" */
  label: string;
  /** 触发该分支的干预指令（main 分支缺省） */
  instruction?: string;
  /** 干预点节点 id（main 分支缺省） */
  targetNodeId?: string;
  /** 该分支的思维树 */
  tree: ThoughtTreeResult;
  /** 该分支改写的报告章节（agentId → markdown） */
  sectionOverrides: Record<string, string>;
}

export interface BranchRerunPayload {
  /** 将派生出的分支 id */
  branchId: string;
  /** 干预点是否在原树中找到 */
  found: boolean;
  targetNodeId: string;
  /** 干预点的父节点 id（干预点是根时缺省） */
  parentNodeId?: string;
  agentId?: string;
  agentLabel?: string;
  instruction: string;
  /** 保留的历史路径（root → 干预点的父链，不含干预点自身） */
  retainedNodes: ThoughtTreeNode[];
  /** 被截断的节点 id（干预点及其全部后代） */
  truncatedNodeIds: string[];
  /** 插入的人工干预节点（其下已挂「重算结果」节点） */
  interventionNode: ThoughtTreeNode;
  /** 供真实重算使用的上下文文本（保留路径的标题 + 正文） */
  contextText: string;
  /** 需要重算的 Agent id（干预点及其后代的去重集合） */
  rerunAgentIds: string[];
}

export interface InterventionSection {
  agentId: string;
  output: string;
}

/* ── id / 标签 ── */

/** 派生下一个分支 id：main → branch-1 → branch-2（复用空缺的最小序号） */
export function nextBranchId(existing: readonly string[]): string {
  const taken = new Set(existing);
  let n = 1;
  while (taken.has(`branch-${n}`)) n += 1;
  return `branch-${n}`;
}

/** 指令摘要（用于分支标签 / 节点标题） */
export function summarizeInstruction(instruction: string, max = 24): string {
  const text = (instruction ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "分支重算";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function branchLabel(id: string, instruction?: string): string {
  if (id === MAIN_BRANCH_ID) return "主推理分支 (Main)";
  const ordinal = id.replace(/^branch-/, "");
  return `分支 ${ordinal}: ${summarizeInstruction(instruction ?? "")} (Intervened)`;
}

/* ── 树工具（私有） ── */

function findPath(root: ThoughtTreeNode, id: string): ThoughtTreeNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const sub = findPath(child, id);
    if (sub) return [root, ...sub];
  }
  return null;
}

function collectSubtree(node: ThoughtTreeNode): ThoughtTreeNode[] {
  const out: ThoughtTreeNode[] = [node];
  for (const child of node.children) out.push(...collectSubtree(child));
  return out;
}

/** 浅克隆：自身字段 + children 数组副本（不触碰原节点） */
function cloneShell(node: ThoughtTreeNode): ThoughtTreeNode {
  return { ...node, children: [...node.children] };
}

function makeInterventionNode(
  branchId: string,
  target: ThoughtTreeNode | undefined,
  instruction: string,
): ThoughtTreeNode {
  const summary = summarizeInstruction(instruction);
  const rerun: ThoughtTreeNode = {
    id: `${branchId}-rerun`,
    kind: "decision",
    title: instruction ? `按干预重算：${summary}` : "按干预重算",
    detail: instruction
      ? `人工干预约束：${instruction}\n由分支「${branchId}」重新推导该步骤及其下游。`
      : `由分支「${branchId}」重新推导该步骤及其下游（未填写明确指令）。`,
    stepIndexes: [],
    children: [],
  };
  if (target?.agentId) rerun.agentId = target.agentId;
  if (target?.agentLabel) rerun.agentLabel = target.agentLabel;
  if (target?.reportAnchor) rerun.reportAnchor = target.reportAnchor;

  const node: ThoughtTreeNode = {
    id: `${branchId}-intervention`,
    kind: "human-intervention",
    title: instruction ? `人工干预：${summary}` : "人工干预",
    detail: instruction ? `用户指令：${instruction}` : "用户指令：（未填写）",
    stepIndexes: [],
    children: [rerun],
  };
  if (target?.reportAnchor) node.reportAnchor = target.reportAnchor;
  return node;
}

/* ── 干预 payload ── */

/**
 * 生成局部重算 payload：保留干预点之前的历史，截断干预点及其下游，插入人工干预节点。
 *
 * @param existingBranchIds 已存在的分支 id（用于派生 `branch-N`）；缺省视为仅 main。
 *   干预点不存在时返回 `found: false` 的安全结果，不抛错。
 */
export function prepareBranchRerun(
  tree: ThoughtTreeResult,
  targetNodeId: string,
  instruction: string,
  existingBranchIds: readonly string[] = [],
): BranchRerunPayload {
  const instructionText = (instruction ?? "").trim();
  const branchId = nextBranchId([MAIN_BRANCH_ID, ...existingBranchIds]);

  const fallback: BranchRerunPayload = {
    branchId,
    found: false,
    targetNodeId,
    instruction: instructionText,
    retainedNodes: [],
    truncatedNodeIds: [],
    interventionNode: makeInterventionNode(branchId, undefined, instructionText),
    contextText: "",
    rerunAgentIds: [],
  };

  try {
    const path = tree ? findPath(tree.root, targetNodeId) : null;
    if (!path) return fallback;

    const target = path[path.length - 1];
    const parent = path.length > 1 ? path[path.length - 2] : undefined;
    const retainedNodes = path.slice(0, -1);
    const truncated = collectSubtree(target);
    const rerunAgentIds = [
      ...new Set(
        truncated
          .map((n) => n.agentId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    const payload: BranchRerunPayload = {
      branchId,
      found: true,
      targetNodeId,
      agentId: target.agentId,
      agentLabel: target.agentLabel,
      instruction: instructionText,
      retainedNodes,
      truncatedNodeIds: truncated.map((n) => n.id),
      interventionNode: makeInterventionNode(branchId, target, instructionText),
      contextText: retainedNodes
        .map((n) => (n.detail ? `${n.title}\n${n.detail}` : n.title))
        .join("\n\n"),
      rerunAgentIds,
    };
    if (parent) payload.parentNodeId = parent.id;
    return payload;
  } catch {
    return fallback;
  }
}

/* ── 分支树重建 ── */

/**
 * 依据 payload 重建分支树：克隆干预点之前的历史路径，把干预点替换为
 * `human-intervention` 节点（其下挂重算结果）。原树不被改动。
 */
export function materializeBranchTree(
  tree: ThoughtTreeResult,
  payload: BranchRerunPayload,
): ThoughtTreeResult {
  if (!payload.found || !tree) return tree;
  const path = findPath(tree.root, payload.targetNodeId);
  if (!path) return tree;

  const parentPath = path.slice(0, -1);
  if (parentPath.length === 0) {
    // 干预点即根：保留根壳，其下换成干预节点
    const newRoot = cloneShell(tree.root);
    newRoot.children = [payload.interventionNode];
    return summarizeTree(newRoot);
  }

  const clones = parentPath.map(cloneShell);
  for (let i = 0; i < clones.length - 1; i++) {
    const next = clones[i + 1];
    clones[i].children = clones[i].children.map((c) => (c.id === next.id ? next : c));
  }
  const parent = clones[clones.length - 1];
  parent.children = parent.children
    .filter((c) => c.id !== payload.targetNodeId)
    .concat(payload.interventionNode);
  return summarizeTree(clones[0]);
}

/* ── 分支构造 ── */

/** 主分支：直接取原始推理步骤构建的树 */
export function createMainBranch(steps: ReasoningStep[]): Branch {
  return {
    id: MAIN_BRANCH_ID,
    label: branchLabel(MAIN_BRANCH_ID),
    tree: buildThoughtTree(steps),
    sectionOverrides: {},
  };
}

/** 从干预点派生一个新分支（main → branch-1 → …）；传入 sections 时同步生成章节覆盖 */
export function createInterventionBranch(
  tree: ThoughtTreeResult,
  targetNodeId: string,
  instruction: string,
  existingBranchIds: readonly string[] = [],
  sections: InterventionSection[] = [],
): Branch {
  const payload = prepareBranchRerun(tree, targetNodeId, instruction, existingBranchIds);
  return {
    id: payload.branchId,
    label: branchLabel(payload.branchId, payload.instruction),
    instruction: payload.instruction,
    targetNodeId: payload.targetNodeId,
    tree: materializeBranchTree(tree, payload),
    sectionOverrides: buildSectionOverrides(sections, payload),
  };
}

/**
 * 把干预约束落到受影响的报告章节（rerunAgentIds 中存在的章节）。
 * 章节正文保留原文，追加一段标注清楚的人工干预约束 —— 不做静默替换。
 */
export function buildSectionOverrides(
  sections: InterventionSection[],
  payload: BranchRerunPayload,
): Record<string, string> {
  const targets = new Set(payload.rerunAgentIds);
  const overrides: Record<string, string> = {};
  for (const section of sections) {
    if (!targets.has(section.agentId)) continue;
    overrides[section.agentId] =
      `${section.output}\n\n${CONSTRAINT_HEADER}\n\n` +
      `- 干预点：${payload.agentLabel ?? payload.agentId ?? "未知"}\n` +
      `- 指令：${payload.instruction || "（未填写）"}\n` +
      `- 分支：${payload.branchId}\n`;
  }
  return overrides;
}
