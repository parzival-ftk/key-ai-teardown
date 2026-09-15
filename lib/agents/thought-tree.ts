import { REPORT_SECTIONS } from "@/lib/report/sections";
import type { ReasoningStep, ReasoningStepKind } from "./reasoning-parser";

/**
 * 多 Agent 思维树构建引擎（W23）。
 *
 * 把 `parseReasoningTrace` 产出的**线性步骤流**还原成「谁在推导、谁在质疑、谁做了修正」
 * 的分化结构：
 *
 *     PrdAgent 主推导(branch)
 *       └─ RebuttalAgent 质疑(conflict)
 *            └─ PrdAgent 修正(decision)
 *
 * 结构规则（确定性启发式，不依赖 LLM）：
 *   1. 先把连续同 Agent 的步骤聚成一个「段」。
 *   2. 独立分析段（无 Agent 竞争）在根下**并列**，形成分支；
 *      质疑段（critic / rebuttal Agent，或含质疑措辞的无标签段）挂到它质疑的段之下；
 *      质疑之后的收敛段升级为「结论」节点。
 *   3. 只有一个段（或全无 Agent 标签）时，**降级为逐步串联的线性树干** —— 绝不抛错。
 *
 * 纯函数、可在 Node 下单测；`lib` 侧只依赖其它 `lib` 模块（不引 components）。
 */

export type ThoughtNodeKind =
  | "root"
  | "branch"
  | "conflict"
  | "decision"
  /** W24：人工干预节点（分支重算的插入点） */
  | "human-intervention";

export const THOUGHT_KIND_LABEL: Record<ThoughtNodeKind, string> = {
  root: "起点",
  branch: "分支",
  conflict: "博弈",
  decision: "结论",
  "human-intervention": "人工干预",
};

export interface ThoughtTreeNode {
  id: string;
  kind: ThoughtNodeKind;
  /** 归一化 Agent id（根节点缺省） */
  agentId?: string;
  /** 原始 Agent 标签（如 "PrdAgent"） */
  agentLabel?: string;
  /** 节点标题（简短：断言 > 动作名 > 首句） */
  title: string;
  /** 详细正文（聚合该段各步骤，供点击展开） */
  detail: string;
  /** 该节点聚合的原始步骤 index */
  stepIndexes: number[];
  /** 该节点合计耗时（毫秒） */
  durationMs?: number;
  /** 报告页对应区块的 DOM 锚点（section-<agentId>）；无对应章节时缺省 */
  reportAnchor?: string;
  children: ThoughtTreeNode[];
}

export interface ThoughtTreeResult {
  root: ThoughtTreeNode;
  /** 全部节点（前序 DFS 展平，含 root） */
  nodes: ThoughtTreeNode[];
  /** 是否退化为线性树干（树中无任何分叉） */
  linear: boolean;
  /** 各节点类型计数 */
  counts: Record<ThoughtNodeKind, number>;
}

const STEP_KIND_LABEL: Record<ReasoningStepKind, string> = {
  thought: "思考",
  action: "行动",
  observation: "观察",
  text: "文本",
};

const CONFLICT_AGENTS = new Set(["devils-advocate", "rebuttal"]);
const DECISION_AGENTS = new Set(["synthesis"]);

/** 无 Agent 标签时的质疑措辞（保守：只认明确的辩论信号） */
const CHALLENGE_RE =
  /(站不住脚|不敢苟同|自相矛盾|经不起|漏洞|反驳|质疑|异议|过于乐观|低估|高估|反对|然而|但是)/;
/** 无 Agent 标签时的收敛措辞 */
const DECISION_RE = /(结论|裁决|综上|因此|最终|修正|已解决|定稿)/;

/** 已知报告章节 agent id → DOM 锚点（只有存在对应区块才给锚点，避免点击空跳） */
const REPORT_ANCHOR: Map<string, string> = new Map(
  REPORT_SECTIONS.map((s) => [s.agentId, `section-${s.agentId}`]),
);

const UNLABELED = "__unlabeled__";

interface Segment {
  agentId?: string;
  agentLabel?: string;
  steps: ReasoningStep[];
}

function makeIdGen(): () => string {
  let n = 0;
  return () => `node-${n++}`;
}

function groupIntoSegments(steps: ReasoningStep[]): Segment[] {
  const segments: Segment[] = [];
  for (const step of steps) {
    const key = step.agentId ?? UNLABELED;
    const last = segments[segments.length - 1];
    if (last && (last.agentId ?? UNLABELED) === key) {
      last.steps.push(step);
      if (!last.agentLabel && step.agentLabel) last.agentLabel = step.agentLabel;
    } else {
      segments.push({
        agentId: step.agentId,
        agentLabel: step.agentLabel,
        steps: [step],
      });
    }
  }
  return segments;
}

function segmentText(seg: Segment): string {
  return seg.steps.map((s) => `${s.content} ${s.assertion ?? ""}`).join(" ");
}

/**
 * 判定一段/一步的类型。
 * Agent 身份是**主信号**；仅当无 Agent 标签时才依据文本措辞（避免把正文里
 * 顺带提到的「质疑」误判为博弈节点）。「质疑之后的下一段」升级为结论（修正/收敛）。
 */
function classify(
  agentId: string | undefined,
  text: string,
  prevKind: ThoughtNodeKind | undefined,
): ThoughtNodeKind {
  if (agentId && CONFLICT_AGENTS.has(agentId)) return "conflict";
  if (agentId && DECISION_AGENTS.has(agentId)) return "decision";
  if (!agentId) {
    if (CHALLENGE_RE.test(text)) return "conflict";
    if (DECISION_RE.test(text)) return "decision";
  }
  if (prevKind === "conflict") return "decision";
  return "branch";
}

function firstSentence(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const head = (line.split(/[。！？!?]/)[0] ?? "").trim() || line.trim();
  return head.length > 42 ? `${head.slice(0, 42)}…` : head;
}

function titleOf(seg: Segment): string {
  const first = seg.steps[0];
  if (first?.assertion) return first.assertion;
  const withAction = seg.steps.find((s) => s.action);
  if (withAction?.action) return withAction.action;
  if (first) return firstSentence(first.content);
  return seg.agentLabel ?? "步骤";
}

function makeNode(seg: Segment, kind: ThoughtNodeKind, id: string): ThoughtTreeNode {
  const node: ThoughtTreeNode = {
    id,
    kind,
    title: titleOf(seg),
    detail: seg.steps
      .map((s) => `${STEP_KIND_LABEL[s.kind]}：${s.content}`)
      .join("\n"),
    stepIndexes: seg.steps.map((s) => s.index),
    children: [],
  };
  if (seg.agentId) node.agentId = seg.agentId;
  if (seg.agentLabel) node.agentLabel = seg.agentLabel;
  const durations = seg.steps
    .map((s) => s.durationMs)
    .filter((d): d is number => typeof d === "number");
  if (durations.length > 0) {
    node.durationMs = durations.reduce((sum, d) => sum + d, 0);
  }
  const anchor = seg.agentId ? REPORT_ANCHOR.get(seg.agentId) : undefined;
  if (anchor) node.reportAnchor = anchor;
  return node;
}

function makeRoot(id: string): ThoughtTreeNode {
  return {
    id,
    kind: "root",
    title: "推理起点",
    detail: "",
    stepIndexes: [],
    children: [],
  };
}

/** 前序 DFS 展平（含 root） */
export function flattenThoughtTree(root: ThoughtTreeNode): ThoughtTreeNode[] {
  const out: ThoughtTreeNode[] = [];
  const walk = (node: ThoughtTreeNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

function countKinds(nodes: ThoughtTreeNode[]): Record<ThoughtNodeKind, number> {
  const counts: Record<ThoughtNodeKind, number> = {
    root: 0,
    branch: 0,
    conflict: 0,
    decision: 0,
    "human-intervention": 0,
  };
  for (const node of nodes) counts[node.kind] += 1;
  return counts;
}

/** 由根节点重算整棵树的摘要（节点表 / 是否线性 / 类型计数） */
export function summarizeTree(root: ThoughtTreeNode): ThoughtTreeResult {
  const nodes = flattenThoughtTree(root);
  return {
    root,
    nodes,
    linear: !nodes.some((n) => n.children.length > 1),
    counts: countKinds(nodes),
  };
}

/** 线性树干：逐步串联（单 Agent / 缺上下文时的安全降级） */
function buildTrunk(steps: ReasoningStep[], idGen: () => string): ThoughtTreeNode {
  const root = makeRoot(idGen());
  let parent = root;
  let prevKind: ThoughtNodeKind | undefined;
  for (const step of steps) {
    const seg: Segment = {
      agentId: step.agentId,
      agentLabel: step.agentLabel,
      steps: [step],
    };
    const kind = classify(step.agentId, segmentText(seg), prevKind);
    const node = makeNode(seg, kind, idGen());
    parent.children.push(node);
    parent = node;
    prevKind = kind;
  }
  return root;
}

/** 多段：并列分析 + 质疑分支 + 收敛结论 */
function buildBranched(segments: Segment[], idGen: () => string): ThoughtTreeNode {
  const root = makeRoot(idGen());
  let current: ThoughtTreeNode | null = null;
  for (const seg of segments) {
    const kind = classify(seg.agentId, segmentText(seg), current?.kind);
    const node = makeNode(seg, kind, idGen());
    let parent: ThoughtTreeNode;
    if (current && (current.kind === "conflict" || current.kind === "decision")) {
      // 质疑之后的修正/收敛，挂在博弈节点之下
      parent = current;
    } else if (kind === "conflict" || kind === "decision") {
      // 质疑挂到它质疑的那个分支之下
      parent = current ?? root;
    } else {
      // 独立分析 → 根下的并列分支
      parent = root;
    }
    parent.children.push(node);
    current = node;
  }
  return root;
}

/**
 * 构建思维树。
 *
 * @param steps `parseReasoningTrace` 产出的推理步骤。
 *   空数组 / 非数组 / 任何异常 → 返回仅含根节点的安全结果，**绝不抛错**。
 */
export function buildThoughtTree(steps: ReasoningStep[]): ThoughtTreeResult {
  try {
    const idGen = makeIdGen();
    if (!Array.isArray(steps) || steps.length === 0) {
      return summarizeTree(makeRoot(idGen()));
    }
    const segments = groupIntoSegments(steps);
    const root =
      segments.length <= 1
        ? buildTrunk(segments[0]?.steps ?? [], idGen)
        : buildBranched(segments, idGen);
    return summarizeTree(root);
  } catch {
    return summarizeTree(makeRoot("node-0"));
  }
}
