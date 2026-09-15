import type { AgentEvent } from "@/lib/types/events";

/**
 * Agent 推理日志解析引擎（W22）。
 *
 * 把「分析过程中产生的原始日志」提炼成结构化的思考步骤时间轴：
 *   - 输入二选一：原始文本日志（ReAct 风格的 Thought/Action/Observation），
 *     或分析期间累积的 `AgentEvent[]`（agent:start / token / done / error）。
 *   - 输出统一的 `ReasoningStep[]`，供 `components/agent/ReasoningTimeline` 渲染。
 *
 * 设计纪律（与 lib/agents/structured-output.ts 同源的「三级降级」思路）：
 *   解析**永不抛错**。空日志 / 非标准文本 / 未闭合的思考块 —— 一律降级为
 *   纯文本步骤，而不是让整个报告页因为一段脏日志崩掉。
 *
 * 纯函数、零依赖：不读 window / 不引 components，可在 Node 下单测。
 */

export type ReasoningStepKind = "thought" | "action" | "observation" | "text";

export interface ReasoningStep {
  /** 步骤序号（0 起，按出现顺序） */
  index: number;
  kind: ReasoningStepKind;
  /** 归一化后的 Agent id（如 "prd"）；无法识别时缺省 */
  agentId?: string;
  /** 原始 Agent 标签（如 "PrdAgent"）；来自日志标签或事件 name */
  agentLabel?: string;
  /** 步骤正文（已剥离耗时标记） */
  content: string;
  /** Action 动作名（kind === "action" 时尽力提取） */
  action?: string;
  /** 关键推理断言（加粗 / 「结论：」等标记提炼；可能缺省） */
  assertion?: string;
  /** 本步耗时（毫秒）；能解析到「耗时 1.2s」「[+350ms]」或事件时间戳时给出 */
  durationMs?: number;
}

export interface ReasoningAgentSummary {
  agentId: string;
  /** 展示名：优先 Agent 标签，否则退化为 id */
  label: string;
  stepCount: number;
  thoughtCount: number;
  actionCount: number;
  observationCount: number;
  /** 该 Agent 累计耗时（各步 durationMs 之和） */
  totalDurationMs: number;
  /** 是否至少有一个步骤带耗时（区分「0ms」与「未知」） */
  hasDuration: boolean;
}

/** 无 Agent 标签的步骤归入此合成分组（供 UI 筛选时也能选中） */
export const UNLABELED_AGENT_ID = "unlabeled";

/* ── Agent 标签归一化 ── */

const AGENT_ALIASES: Record<string, string> = {
  market: "market",
  marketagent: "market",
  competitor: "market",
  competitoragent: "market",
  userresearch: "user-research",
  userresearchagent: "user-research",
  researcher: "user-research",
  researcherment: "user-research",
  interviewer: "interviewer",
  intervieweragent: "interviewer",
  visualdesign: "visual-design",
  visualdesignagent: "visual-design",
  business: "business",
  businessagent: "business",
  devilsadvocate: "devils-advocate",
  devilsadvocateagent: "devils-advocate",
  critic: "devils-advocate",
  criticagent: "devils-advocate",
  rebuttal: "rebuttal",
  rebuttalagent: "rebuttal",
  synthesis: "synthesis",
  synthesisagent: "synthesis",
  prd: "prd",
  prdagent: "prd",
  uicode: "ui-code",
  uicodeagent: "ui-code",
};

/** 标记关键词（大小写/全半角归一后）——它们不是 Agent 标签 */
const MARKER_WORDS = new Set([
  "thought",
  "thinking",
  "思考",
  "action",
  "行动",
  "动作",
  "observation",
  "观察",
  "观察结果",
  "result",
  "结果",
]);

const compact = (label: string): string =>
  label.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * 把 Agent 标签归一化为项目内的 agent id。
 * 认得「PascalCase + Agent 后缀」（PrdAgent）与已知别名（market / prd / …）；
 * 未知但形如标识符的标签保留其归一化形式，便于分组而非丢弃。
 */
export function normalizeAgentId(label: string): string | undefined {
  const c = compact(label);
  if (!c) return undefined;
  if (AGENT_ALIASES[c]) return AGENT_ALIASES[c];
  const base = c.replace(/agent$/, "");
  if (!base) return undefined;
  if (AGENT_ALIASES[base]) return AGENT_ALIASES[base];
  return /^[a-z][a-z0-9]*$/.test(base) ? base : undefined;
}

function looksLikeAgentLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (MARKER_WORDS.has(trimmed.toLowerCase())) return false;
  const c = compact(trimmed);
  if (!c) return false;
  return (
    c.endsWith("agent") ||
    AGENT_ALIASES[c] !== undefined ||
    AGENT_ALIASES[c.replace(/agent$/, "")] !== undefined
  );
}

/* ── 文本结构识别 ── */

const BRACKET_TAG = /^\[\s*([^\]\n]+?)\s*\]\s*(.*)$/;
const COLON_TAG = /^([A-Za-z][\w.-]*)\s*[:：>]\s*(.*)$/;

function matchAgentTag(line: string): { label: string; rest: string } | null {
  const br = BRACKET_TAG.exec(line);
  if (br && looksLikeAgentLabel(br[1])) return { label: br[1].trim(), rest: br[2] };
  const col = COLON_TAG.exec(line);
  if (col && looksLikeAgentLabel(col[1])) return { label: col[1].trim(), rest: col[2] };
  return null;
}

const MARKER =
  /^(?:[-*+>]\s*)?\*{0,2}\s*(Thought|Thinking|思考|Action|行动|动作|Observation|观察结果|观察)\s*\*{0,2}\s*[:：]\s*(.*)$/i;

function matchMarker(line: string): { kind: ReasoningStepKind; content: string } | null {
  const m = MARKER.exec(line);
  if (!m) return null;
  const word = m[1].toLowerCase();
  let kind: ReasoningStepKind = "text";
  if (word === "thought" || word === "thinking" || word === "思考") kind = "thought";
  else if (word === "action" || word === "行动" || word === "动作") kind = "action";
  else if (word === "observation" || word === "观察" || word === "观察结果")
    kind = "observation";
  return { kind, content: (m[2] ?? "").trim() };
}

/** 思考块标签（闭合时识别为结构步骤；不闭合则整体降级） */
const BLOCK_TAGS: Array<[RegExp, RegExp]> = [
  [/[\[<]\s*thought\s*[\]>]/gi, /[\[<]\s*\/\s*thought\s*[\]>]/gi],
  [/[\[<]\s*thinking\s*[\]>]/gi, /[\[<]\s*\/\s*thinking\s*[\]>]/gi],
  [/[\[<]\s*action\s*[\]>]/gi, /[\[<]\s*\/\s*action\s*[\]>]/gi],
  [/[\[<]\s*observation\s*[\]>]/gi, /[\[<]\s*\/\s*observation\s*[\]>]/gi],
];

const countMatches = (text: string, re: RegExp): number =>
  (text.match(re) ?? []).length;

function hasUnclosedBlock(text: string): boolean {
  for (const [open, close] of BLOCK_TAGS) {
    if (countMatches(text, open) !== countMatches(text, close)) return true;
  }
  return false;
}

/** 闭合的块标签 → 行标记（先处理闭合，避免开标签正则误吞 `</`） */
function normalizeBlocks(text: string): string {
  return text
    .replace(/[\[<]\s*\/\s*(thought|thinking|action|observation)\s*[\]>]/gi, "\n")
    .replace(/[\[<]\s*(thought|thinking)\s*[\]>]\s*[:：]?/gi, "\nThought: ")
    .replace(/[\[<]\s*action\s*[\]>]\s*[:：]?/gi, "\nAction: ")
    .replace(/[\[<]\s*observation\s*[\]>]\s*[:：]?/gi, "\nObservation: ");
}

/* ── 字段提炼 ── */

const DURATION_PATTERNS: RegExp[] = [
  /(?:耗时|用时|took)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(ms|毫秒|s|秒)/i,
  /[\[\(【]\s*\+?\s*(\d+(?:\.\d+)?)\s*(ms|毫秒|s|秒)\s*[\]\)】]/i,
];

/** 从文本中解析耗时并剥离该标记（返回清理后的正文） */
function takeDuration(text: string): { durationMs?: number; text: string } {
  for (const re of DURATION_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const value = Number(m[1]);
    const unit = m[2].toLowerCase();
    const ms = unit === "ms" || unit === "毫秒" ? value : value * 1000;
    if (!Number.isFinite(ms)) continue;
    const cleaned = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
    return { durationMs: Math.round(ms), text: cleaned };
  }
  return { text };
}

const BOLD_ASSERTION = /\*\*([^*\n]+)\*\*/;
const MARKED_ASSERTION =
  /(?:^|[\n，。；;、])\s*(?:结论|关键|断言|要点|核心)\s*[:：]\s*([^\n。；;]+)/;
const CONCLUSION_ASSERTION = /^\s*(?:因此|所以|综上)[，,]?\s*([^\n。；;]+)/;

/** 提炼「关键推理断言」：加粗 > 「结论：」类标记 > 「因此/所以」 */
function extractAssertion(text: string): string | undefined {
  const bold = BOLD_ASSERTION.exec(text);
  if (bold) return bold[1].trim();
  const marked = MARKED_ASSERTION.exec(text);
  if (marked) return marked[1].trim();
  const concl = CONCLUSION_ASSERTION.exec(text);
  if (concl) return concl[1].trim();
  return undefined;
}

const ACTION_NAME = /^\**\s*([A-Za-z_][\w.\-]*)\s*(?:\(|:|·|\s|$)/;

function extractActionName(text: string): string | undefined {
  const m = ACTION_NAME.exec(text.trim());
  if (!m) return undefined;
  const name = m[1];
  if (MARKER_WORDS.has(name.toLowerCase())) return undefined;
  return name;
}

/* ── 步骤组装 ── */

interface DraftStep {
  kind: ReasoningStepKind;
  content: string;
  agentId?: string;
  agentLabel?: string;
  action?: string;
  assertion?: string;
  durationMs?: number;
}

function finalize(draft: DraftStep[]): ReasoningStep[] {
  const steps: ReasoningStep[] = [];
  for (const d of draft) {
    const content = d.content.trim();
    if (!content) continue;
    const step: ReasoningStep = { index: steps.length, kind: d.kind, content };
    if (d.agentId) step.agentId = d.agentId;
    if (d.agentLabel) step.agentLabel = d.agentLabel;
    if (d.action) step.action = d.action;
    if (d.assertion) step.assertion = d.assertion;
    if (typeof d.durationMs === "number") step.durationMs = d.durationMs;
    steps.push(step);
  }
  return steps;
}

/** 结构化标记丰富化：剥离耗时、提炼断言/动作名 */
function enrich(
  kind: ReasoningStepKind,
  rawContent: string,
  agent: { id?: string; label: string } | null,
): DraftStep {
  const { durationMs, text } = takeDuration(rawContent);
  const step: DraftStep = {
    kind,
    content: text,
    agentId: agent?.id,
    agentLabel: agent?.label,
  };
  if (kind === "action") step.action = extractActionName(text);
  if (kind === "thought" || kind === "observation") {
    const assertion = extractAssertion(text);
    if (assertion) step.assertion = assertion;
  }
  if (typeof durationMs === "number") step.durationMs = durationMs;
  return step;
}

/** 降级路径：整段按空行切段，作为纯文本步骤 */
function degradeToText(raw: string): ReasoningStep[] {
  const paragraphs = raw
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((content, index) => ({ index, kind: "text", content }));
}

/* ── 文本解析 ── */

interface OpenStep {
  kind: ReasoningStepKind;
  agent: { id?: string; label: string } | null;
  buffer: string[];
}

function parseText(raw: string): ReasoningStep[] {
  if (hasUnclosedBlock(raw)) return degradeToText(raw);

  const lines = normalizeBlocks(raw).split(/\r?\n/);
  const draft: DraftStep[] = [];
  let agent: { id?: string; label: string } | null = null;
  let current: OpenStep | null = null;
  let pendingText: string[] = [];

  const flushCurrent = () => {
    if (!current) return;
    const joined = current.buffer.join("\n");
    draft.push(enrich(current.kind, joined, current.agent));
    current = null;
  };
  const flushText = () => {
    if (pendingText.length === 0) return;
    const joined = pendingText.join("\n");
    pendingText = [];
    for (const p of joined.split(/\r?\n\s*\r?\n/)) {
      const content = p.trim();
      if (content) draft.push({ kind: "text", content, agentId: agent?.id, agentLabel: agent?.label });
    }
  };

  for (const rawLine of lines) {
    let line = rawLine;
    const tag = matchAgentTag(line);
    if (tag) {
      flushCurrent();
      flushText();
      agent = { id: normalizeAgentId(tag.label), label: tag.label };
      line = tag.rest;
      if (!line.trim()) continue;
    }
    const marker = matchMarker(line);
    if (marker) {
      flushCurrent();
      flushText();
      current = { kind: marker.kind, agent, buffer: [marker.content] };
      continue;
    }
    if (current) current.buffer.push(line);
    else pendingText.push(line);
  }
  flushCurrent();
  flushText();

  return finalize(draft);
}

/* ── 事件重建 ── */

function readAt(event: AgentEvent): number | undefined {
  const t = (event as { at?: unknown }).at;
  return typeof t === "number" && Number.isFinite(t) ? t : undefined;
}

function span(start: number | undefined, end: number | undefined): number | undefined {
  if (start === undefined || end === undefined || end < start) return undefined;
  return Math.round(end - start);
}

function parseEvents(events: AgentEvent[]): ReasoningStep[] {
  const draft: DraftStep[] = [];
  const open = new Map<string, { label: string; startAt?: number; buffer: string }>();

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const type = (event as { type?: unknown }).type;
    if (typeof type !== "string") continue;

    const withId = event as { agentId?: string };
    switch (type) {
      case "agent:start": {
        const agentId = withId.agentId ?? "";
        const label = (event as { name?: string }).name ?? agentId;
        open.set(agentId, { label, startAt: readAt(event), buffer: "" });
        draft.push({
          kind: "action",
          agentId,
          agentLabel: label,
          content: `${label} 开始执行`,
          action: label,
        });
        break;
      }
      case "agent:token": {
        const o = open.get(withId.agentId ?? "");
        if (o) o.buffer += (event as { delta?: string }).delta ?? "";
        break;
      }
      case "agent:done": {
        const agentId = withId.agentId ?? "";
        const o = open.get(agentId);
        const output = ((event as { output?: string }).output ?? "").trim();
        const content = output || (o?.buffer ?? "").trim();
        const step = enrich("observation", content, {
          id: agentId || undefined,
          label: o?.label ?? agentId,
        });
        const durationMs = span(o?.startAt, readAt(event));
        if (typeof durationMs === "number") step.durationMs = durationMs;
        draft.push(step);
        open.delete(agentId);
        break;
      }
      case "error": {
        const agentId = withId.agentId;
        const message = (event as { message?: string }).message ?? "未知错误";
        draft.push({
          kind: "text",
          agentId,
          content: agentId ? `[${agentId}] 执行失败：${message}` : `错误：${message}`,
        });
        break;
      }
      default:
        // done / 未来新增事件类型：无对应步骤，忽略
        break;
    }
  }

  return finalize(draft);
}

/* ── 公共入口 ── */

/**
 * 解析推理日志。
 *
 * @param rawLog 原始文本日志，或分析期间的 `AgentEvent[]`。
 *   非法输入（null / undefined / 数字等）与空日志返回空数组；**永不抛错**。
 */
export function parseReasoningTrace(rawLog: string | AgentEvent[]): ReasoningStep[] {
  if (Array.isArray(rawLog)) {
    try {
      return parseEvents(rawLog);
    } catch {
      return [];
    }
  }
  if (typeof rawLog !== "string") return [];
  try {
    return parseText(rawLog);
  } catch {
    return degradeToText(rawLog);
  }
}

/** 按 Agent 聚合步骤：分类计数与累计耗时（供时间轴的筛选/耗时统计） */
export function summarizeReasoning(steps: ReasoningStep[]): ReasoningAgentSummary[] {
  const map = new Map<string, ReasoningAgentSummary>();
  for (const step of steps) {
    const agentId = step.agentId ?? UNLABELED_AGENT_ID;
    let entry = map.get(agentId);
    if (!entry) {
      entry = {
        agentId,
        label: step.agentLabel ?? agentId,
        stepCount: 0,
        thoughtCount: 0,
        actionCount: 0,
        observationCount: 0,
        totalDurationMs: 0,
        hasDuration: false,
      };
      map.set(agentId, entry);
    }
    entry.stepCount += 1;
    if (step.kind === "thought") entry.thoughtCount += 1;
    else if (step.kind === "action") entry.actionCount += 1;
    else if (step.kind === "observation") entry.observationCount += 1;
    if (step.agentLabel && entry.label === agentId) entry.label = step.agentLabel;
    if (typeof step.durationMs === "number") {
      entry.totalDurationMs += step.durationMs;
      entry.hasDuration = true;
    }
  }
  return [...map.values()];
}

/** 人类可读的耗时：350ms / 1.2s / 2s / 1m5s */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) {
    const seconds = ms / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
}
