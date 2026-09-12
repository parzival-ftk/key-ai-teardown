import type { ChatMessage } from "@/lib/llm/provider";
import { RUBRIC, type DimensionScores, type RubricDimension } from "./rubric";

/**
 * 质量门禁 eval —— judge（评审官）。
 *
 * judge 把「一份拆解报告」按 rubric 维度打分，返回结构化分数 + 理由。
 * 与编队的元数据解析一样，对模型不守约（输出带围栏 / 夹带说明）采取宽松解析。
 *
 * 纪律：judge 是代理指标、有噪音；parseJudgeOutput 解析失败返回 null（不抛错），
 * 由调用方决定降级（记 0 分并保留告警），不让评审噪声炸掉整轮 eval。
 */

export interface JudgeSample {
  id: string;
  name: string;
  /** 待评审报告全文（编队各段拼接） */
  reportText: string;
}

export interface JudgeVerdict {
  scores: DimensionScores;
  /** 各维度给分理由（缺失维度缺省） */
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

/** 构造 judge 的对话消息（系统提示 + 含 rubric 与报告的 user 消息） */
export function buildJudgeMessages(
  sample: JudgeSample,
  rubric: RubricDimension[] = RUBRIC,
): ChatMessage[] {
  const rubricText = rubric
    .map((d) => `- ${d.id}（${d.name}，权重 ${d.weight}）：${d.description}`)
    .join("\n");

  const user = [
    `被评审产品：${sample.name}`,
    "",
    "评分维度：",
    rubricText,
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
 * 依次尝试：整串 → ```json 围栏内容 → 首个 `{` 起的括号配对切片。
 * 全部失败返回 null。
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
      // 尝试下一种切法
    }
  }
  return null;
}

/**
 * 解析 judge 输出为 JudgeVerdict。
 *
 * 只采纳 rubric 中定义且值为有限数字的维度分；忽略未知键。
 * 一个有效维度都没有 → 返回 null（调用方按「评审失败」降级）。
 */
export function parseJudgeOutput(
  raw: string,
  rubric: RubricDimension[] = RUBRIC,
): JudgeVerdict | null {
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== "object") return null;

  const record = obj as Record<string, unknown>;
  const scoresObj = record.scores;
  const rationaleObj = record.rationale;

  const scores: DimensionScores = {};
  if (scoresObj && typeof scoresObj === "object") {
    const src = scoresObj as Record<string, unknown>;
    for (const dim of rubric) {
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
    for (const dim of rubric) {
      const value = src[dim.id];
      if (typeof value === "string") rationale[dim.id] = value;
    }
  }

  return { scores, rationale };
}
