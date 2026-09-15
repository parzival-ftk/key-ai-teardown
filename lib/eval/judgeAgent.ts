import type { ChatMessage } from "@/lib/llm/provider";
import type { Evidence } from "@/lib/types/evidence";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import {
  DEFAULT_GATE_THRESHOLD,
  EVAL_DIMENSIONS,
  compositeScore,
  type EvaluationDimension,
  type EvaluationDimensionId,
} from "./dimensions";

/**
 * 评估引擎（W14 · Eval 2.0）。
 *
 * 两条路径、**同一份报告结构与同一套维度**：
 * 1. `scoreEvaluation(report)` —— **启发式**（无 LLM、确定性、零成本）。
 *    线上「质量与可信度看板」走这条：报告页不该为了一次打分再花一次 LLM 调用。
 * 2. `buildJudgeMessages` / `parseJudgeOutput` —— **LLM-as-a-judge**（离线 eval 管线走这条）。
 *
 * 纪律：两者都是**代理指标**。启发式只读证据标签与结构关键词，不懂语义；
 * LLM judge 有噪音。分数只用于同一 rubric 下的相对比较，不得当真理。
 */

/* ────────────────────────── 数据结构 ────────────────────────── */

export interface EvaluableSection {
  agentId: string;
  output: string;
  evidence?: Evidence[];
}

export interface EvaluableReport {
  name?: string;
  sections: EvaluableSection[];
}

export interface DimensionResult {
  id: EvaluationDimensionId;
  name: string;
  /** 英文名（看板右侧展示，与需求规格措辞一致） */
  nameEn: string;
  /** 0-100 */
  score: number;
  /** 一句话显式提示（看板上与进度条并排显示） */
  note: string;
  /** 是否因异常被降级（如伪造引用） */
  downgraded: boolean;
}

export interface EvaluationHighlight {
  kind: "strength" | "weakness";
  dimension: EvaluationDimensionId;
  text: string;
}

export interface EvaluationSuggestion {
  dimension: EvaluationDimensionId;
  text: string;
  severity: "hint" | "warn" | "critical";
}

export interface EvaluationReport {
  /** 加权综合分（0-100） */
  composite: number;
  dimensions: DimensionResult[];
  highlights: EvaluationHighlight[];
  suggestions: EvaluationSuggestion[];
  /** 评分来源：启发式（在线看板）或 LLM 评审（离线 eval） */
  source: "heuristic" | "llm";
  gate: { threshold: number; passed: boolean };
}

/** 内部：单维度结论 + 它产生的建议 */
interface DimensionOutcome {
  id: EvaluationDimensionId;
  score: number;
  note: string;
  downgraded: boolean;
  suggestions: EvaluationSuggestion[];
}

/* ────────────────────────── 小工具 ────────────────────────── */

const clamp = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

const DIMENSION_BY_ID = new Map(EVAL_DIMENSIONS.map((d) => [d.id, d]));
const dimensionName = (id: EvaluationDimensionId) =>
  DIMENSION_BY_ID.get(id)?.name ?? id;
const dimensionNameEn = (id: EvaluationDimensionId) =>
  DIMENSION_BY_ID.get(id)?.nameEn ?? id;

const withOutput = (report: EvaluableReport) =>
  report.sections.filter((s) => s.output.trim() !== "");

const outputOf = (report: EvaluableReport, agentId: string) =>
  report.sections.find((s) => s.agentId === agentId)?.output ?? "";

const EXPECTED_SECTIONS = REPORT_SECTIONS.length;

/* ────────────────────────── 四个维度 ────────────────────────── */

/** 逻辑自洽性：段落覆盖 + 辩论链闭合 + 综合段是否给出裁决 */
export function scoreConsistency(report: EvaluableReport): DimensionOutcome {
  const coverage = withOutput(report).length / EXPECTED_SECTIONS;
  const chain = ["devils-advocate", "rebuttal", "synthesis"].filter(
    (id) => outputOf(report, id).trim() !== "",
  );
  const synthesis = outputOf(report, "synthesis");
  const hasVerdict = /分歧|裁决|取舍/.test(synthesis);

  const score = clamp(
    coverage * 50 + (chain.length / 3) * 35 + (hasVerdict ? 15 : 0),
  );

  const suggestions: EvaluationSuggestion[] = [];
  if (chain.length < 3) {
    suggestions.push({
      dimension: "consistency",
      severity: "warn",
      text: `辩论链不完整（缺 ${["反方质疑", "质疑答辩", "综合裁决"].filter((_, i) => !chain[i]).join("、")}），结论未经质询即落地。`,
    });
  }
  if (synthesis.trim() !== "" && !hasVerdict) {
    suggestions.push({
      dimension: "consistency",
      severity: "hint",
      text: "综合段未显式给出分歧裁决 —— 并列复述会让矛盾结论同时留在报告里。",
    });
  }
  if (coverage < 0.6) {
    suggestions.push({
      dimension: "consistency",
      severity: "warn",
      text: `仅 ${Math.round(coverage * 100)}% 的段落有产出，报告完整度不足。`,
    });
  }

  return {
    id: "consistency",
    score,
    note: `辩论链 ${chain.length}/3 · 段落覆盖 ${Math.round(coverage * 100)}%${hasVerdict ? " · 已给裁决" : ""}`,
    downgraded: false,
    suggestions,
  };
}

/** JTBD 匹配度：三层 job + 画像聚类 + 摩擦点 */
export function scoreJtbd(report: EvaluableReport): DimensionOutcome {
  const text = `${outputOf(report, "user-research")}\n${outputOf(report, "interviewer")}`;
  if (text.trim() === "") {
    return {
      id: "jtbd",
      score: 0,
      note: "缺少用户研究与访谈产出",
      downgraded: false,
      suggestions: [
        {
          dimension: "jtbd",
          severity: "critical",
          text: "没有用户画像与 JTBD —— 后续所有结论都缺少用户侧依据。",
        },
      ],
    };
  }

  const layers = ["functional", "emotional", "social"];
  const hitLayers = layers.filter((k) => new RegExp(k, "i").test(text));
  const hasPersona = /画像|persona/i.test(text);
  const hasFriction = /摩擦点|friction|抱怨/.test(text);

  const score = clamp(
    (hitLayers.length / layers.length) * 45 +
      (hasPersona ? 25 : 0) +
      (hasFriction ? 30 : 0),
  );

  const missing = layers.filter((k) => !hitLayers.includes(k));
  const suggestions: EvaluationSuggestion[] = [];
  if (missing.length > 0) {
    suggestions.push({
      dimension: "jtbd",
      severity: "warn",
      text: `JTBD 缺少 ${missing.join(" / ")} 层 —— 只讲功能需求会漏掉情感与社会动机。`,
    });
  }
  if (!hasFriction) {
    suggestions.push({
      dimension: "jtbd",
      severity: "hint",
      text: "访谈未暴露摩擦点，用户证言容易滑成「只说好话」。",
    });
  }

  return {
    id: "jtbd",
    score,
    note: `三层 job ${hitLayers.length}/3${hasPersona ? " · 有画像" : ""}${hasFriction ? " · 有摩擦点" : ""}`,
    downgraded: false,
    suggestions,
  };
}

/**
 * 证据追溯度：以「可追溯的已核实」占比为基，**无来源的「已核实」按伪造引用重罚**。
 * 这条直接对应 W1 的硬不变量：无法机械核验回输入的结论不配叫「已核实」。
 */
export function scoreTraceability(report: EvaluableReport): DimensionOutcome {
  const evidence = report.sections.flatMap((s) => s.evidence ?? []);
  const total = evidence.length;
  if (total === 0) {
    return {
      id: "traceability",
      score: 0,
      note: "未附带任何证据标签",
      downgraded: false,
      suggestions: [
        {
          dimension: "traceability",
          severity: "critical",
          text: "报告没有任何证据标签 —— 无法判断哪些结论有来源、哪些是推测。",
        },
      ],
    };
  }

  const verified = evidence.filter((e) => e.label === "verified");
  const fabricated = verified.filter((e) => !e.source || e.source.trim() === "");
  const okVerified = verified.length - fabricated.length;
  const missing = evidence.filter((e) => e.label === "missing").length;

  const downgraded = fabricated.length > 0;
  let score = (okVerified / total) * 100;
  if (downgraded) score -= fabricated.length * 15;

  const share = Math.round((okVerified / total) * 100);
  const suggestions: EvaluationSuggestion[] = [];
  if (downgraded) {
    suggestions.push({
      dimension: "traceability",
      severity: "critical",
      text: `发现 ${fabricated.length} 条「已核实」没有来源（伪造引用），已按伪造降级计并扣分。`,
    });
  }
  if (missing / total > 0.4) {
    suggestions.push({
      dimension: "traceability",
      severity: "warn",
      text: `缺失项占比 ${Math.round((missing / total) * 100)}% —— 关键信息缺口大，结论稳定性低。`,
    });
  }

  const noteParts = [`${share}% 结论已核实（${okVerified}/${total} 条`];
  if (missing > 0) noteParts.push(` · ${missing} 条缺失`);
  noteParts.push("）");

  return {
    id: "traceability",
    score: clamp(score),
    note: noteParts.join(""),
    downgraded,
    suggestions,
  };
}

/** PRD 可落地性：六项结构齐备度 */
export const PRD_CHECKS: Array<{ label: string; pattern: RegExp }> = [
  { label: "用户故事", pattern: /用户故事|as a/i },
  { label: "验收标准", pattern: /验收标准|given[\s\S]{0,40}when[\s\S]{0,40}then/i },
  { label: "成功指标", pattern: /成功指标|北极星|护栏/ },
  { label: "功能范围", pattern: /功能范围|范围|mvp|不做/i },
  { label: "发布就绪清单", pattern: /发布就绪|就绪清单/ },
  { label: "风险与依赖", pattern: /风险|依赖/ },
];

export function scorePrd(report: EvaluableReport): DimensionOutcome {
  const text = outputOf(report, "prd");
  if (text.trim() === "") {
    return {
      id: "prd",
      score: 0,
      note: "缺少 PRD 段落",
      downgraded: false,
      suggestions: [
        {
          dimension: "prd",
          severity: "critical",
          text: "没有 PRD 产出 —— 分析没有落到可开发的交付物。",
        },
      ],
    };
  }

  const hit = PRD_CHECKS.filter((c) => c.pattern.test(text));
  const missing = PRD_CHECKS.filter((c) => !hit.includes(c)).map((c) => c.label);
  const score = clamp((hit.length / PRD_CHECKS.length) * 100);

  const suggestions: EvaluationSuggestion[] = [];
  if (missing.length > 0) {
    suggestions.push({
      dimension: "prd",
      severity: missing.length >= 3 ? "warn" : "hint",
      text: `PRD 缺少 ${missing.join(" / ")} —— 研发拿到会反复追问。`,
    });
  }

  return {
    id: "prd",
    score,
    note: `${hit.length}/${PRD_CHECKS.length} 项齐备${missing.length ? ` · 缺 ${missing.join("/")}` : ""}`,
    downgraded: false,
    suggestions,
  };
}

/* ────────────────────────── 组装 ────────────────────────── */

function buildHighlights(dimensions: DimensionResult[]): EvaluationHighlight[] {
  const sorted = [...dimensions].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const out: EvaluationHighlight[] = [];
  if (best && best.score >= 70) {
    out.push({
      kind: "strength",
      dimension: best.id,
      text: `${best.name} ${best.score} 分：${best.note}`,
    });
  }
  if (worst && worst.score < 60) {
    out.push({
      kind: "weakness",
      dimension: worst.id,
      text: `${worst.name} ${worst.score} 分：${worst.note}`,
    });
  }
  return out;
}

/** 启发式评估（无 LLM，确定性）。空报告 → 全维 0 分 + critical 建议。 */
export function scoreEvaluation(
  report: EvaluableReport,
  options: { threshold?: number; dimensions?: EvaluationDimension[] } = {},
): EvaluationReport {
  const dimensions = options.dimensions ?? EVAL_DIMENSIONS;
  const outcomes = [
    scoreConsistency(report),
    scoreJtbd(report),
    scoreTraceability(report),
    scorePrd(report),
  ];

  const scores: Record<string, number> = {};
  for (const outcome of outcomes) scores[outcome.id] = outcome.score;
  const composite = compositeScore(scores, dimensions);

  const results: DimensionResult[] = outcomes.map((o) => ({
    id: o.id,
    name: dimensionName(o.id),
    nameEn: dimensionNameEn(o.id),
    score: o.score,
    note: o.note,
    downgraded: o.downgraded,
  }));

  const suggestions = outcomes.flatMap((o) => o.suggestions);
  if (withOutput(report).length === 0) {
    suggestions.unshift({
      dimension: "consistency",
      severity: "critical",
      text: "报告为空，无可评估内容。",
    });
  }

  const threshold = options.threshold ?? DEFAULT_GATE_THRESHOLD;
  return {
    composite,
    dimensions: results,
    highlights: buildHighlights(results),
    suggestions,
    source: "heuristic",
    gate: { threshold, passed: composite >= threshold },
  };
}

/* ────────────────────────── LLM-as-a-judge ────────────────────────── */

export interface JudgeSample {
  id: string;
  name: string;
  /** 待评审报告全文（编队各段拼接） */
  reportText: string;
}

export interface JudgeVerdict {
  scores: Record<string, number>;
  rationale: Record<string, string>;
}

const JUDGE_SYSTEM = `你是 Key 的质量评审官（judge）。你要对一份「AI 产品拆解报告」按给定评分维度打分。

要求：
- 严格、独立、可复现：不因报告篇幅长就给高分，不因文风华丽就加分。
- 每个维度给 0-100 的整数分，并给一句给分理由。
- 只评价这份报告本身的质量，不要补充你自己的分析或改写成你自己的版本。
- 回答的**最末尾**只输出一个 JSON 对象（可放在 \`\`\`json 代码块里），格式为：
{"scores": {"<维度 id>": 0}, "rationale": {"<维度 id>": "理由"}}
其中 scores 的键必须覆盖下方列出的**全部**维度 id。`;

/** 构造 judge 的对话消息（系统提示 + 含维度定义与报告的 user 消息） */
export function buildJudgeMessages(
  sample: JudgeSample,
  dimensions: EvaluationDimension[] = EVAL_DIMENSIONS,
): ChatMessage[] {
  const dimensionText = dimensions
    .map((d) => `- ${d.id}（${d.name} / ${d.nameEn}，权重 ${d.weight}）：${d.description}`)
    .join("\n");

  const user = [
    `被评审产品：${sample.name}`,
    "",
    "评分维度：",
    dimensionText,
    "",
    "待评审报告（Markdown）：",
    "```markdown",
    sample.reportText,
    "```",
    "",
    "请按上述维度打分，并在最后输出 JSON。",
  ].join("\n");

  return [
    { role: "system", content: JUDGE_SYSTEM },
    { role: "user", content: user },
  ];
}

/**
 * 宽松抽取文本中的第一个完整 JSON 对象。
 * 依次尝试：整串 → ```json 围栏内容 → 首个 `{` 起的括号配对切片。全部失败返回 null。
 */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const attempts: string[] = [trimmed];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced && fenced[1].trim()) attempts.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    for (let i = firstBrace; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          attempts.push(trimmed.slice(firstBrace, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 换下一种切法
    }
  }
  return null;
}

/**
 * 解析 judge 输出。只采纳维度表中定义且为有限数字的分；忽略未知键。
 * 一个有效维度都没有 → 返回 null（调用方按「评审失败」降级为 0 分，不抛错）。
 */
export function parseJudgeOutput(
  raw: string,
  dimensions: EvaluationDimension[] = EVAL_DIMENSIONS,
): JudgeVerdict | null {
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== "object") return null;

  const record = obj as Record<string, unknown>;
  const scoresObj = record.scores;
  const rationaleObj = record.rationale;

  const scores: Record<string, number> = {};
  if (scoresObj && typeof scoresObj === "object") {
    const src = scoresObj as Record<string, unknown>;
    for (const dim of dimensions) {
      const value = src[dim.id];
      if (typeof value === "number" && Number.isFinite(value)) {
        scores[dim.id] = value;
      }
    }
  }
  if (Object.keys(scores).length === 0) return null;

  const rationale: Record<string, string> = {};
  if (rationaleObj && typeof rationaleObj === "object") {
    const src = rationaleObj as Record<string, unknown>;
    for (const dim of dimensions) {
      const value = src[dim.id];
      if (typeof value === "string") rationale[dim.id] = value;
    }
  }

  return { scores, rationale };
}
