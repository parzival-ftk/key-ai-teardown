import type { Evidence, EvidenceLabel } from "@/lib/types/evidence";
import type { EvaluableReport, EvaluableSection } from "./judgeAgent";

/**
 * 红队防幻觉（W16）。
 *
 * 在「证据归一化（W1）」之外再加一层**对抗性检查**：不只看来源能不能核验，
 * 还看结论之间是否自相矛盾、以及有没有「带具体数字却无来源」的虚构事实。
 * 命中即**强制降级**对应结论的标签，并把拦截过程完整记录成可审计的日志。
 *
 * 标签映射说明：需求规格写的降级目标是 `missing` / `conjecture`，
 * 但本仓库的证据标签只有 verified / inferred / missing（lib/types/evidence.ts），
 * 没有 conjecture —— 它对应的就是 `inferred`（推测）。故映射为：
 *   虚构引用 → inferred（有推理成分但无来源）
 *   与核验库矛盾 / 无法核实 → missing
 *
 * 纯函数、无 LLM、确定性：可单测，也可在报告页即时运行。
 */

export type RedTeamFindingKind =
  | "fabricated_citation"
  | "unsupported_metric"
  | "contradiction";

export interface RedTeamDowngrade {
  sectionId: string;
  evidenceIndex: number;
  claim: string;
  from: EvidenceLabel;
  to: EvidenceLabel;
  reason: string;
}

export interface RedTeamFinding {
  kind: RedTeamFindingKind;
  /** blocked = 已强制降级；flagged = 记录但无对应证据可降级 */
  severity: "blocked" | "flagged";
  sectionId: string | null;
  detail: string;
  downgrades: RedTeamDowngrade[];
}

export interface RedTeamReport {
  findings: RedTeamFinding[];
  /** 被拦截（已强制降级）的结论条数 */
  blockedCount: number;
  downgrades: RedTeamDowngrade[];
}

/** 具体数值型断言常涉及的指标词（对齐 OUTPUT_RULES 里「不得编造」的那几类） */
const METRIC_TERM =
  /(市场规模|市场体量|营收|收入|用户数|用户规模|付费率|转化率|留存|市场份额|份额|GMV|DAU|MAU|ARR|估值|增长率|单价|客单价)/;

/** 粗粒度数值：百分数 / 带量级单位的数字 */
const NUMERIC_VALUE =
  /(\d+(?:\.\d+)?)\s*(%|％|个百分点|万|亿|千万|百万|千|美元|元)/;

export interface MetricStatement {
  sectionId: string;
  sentence: string;
  term: string;
  value: string;
}

const splitSentences = (text: string) =>
  text
    .split(/[\n。；;！!？?]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");

/** 抽出报告里所有「指标 + 具体数值」的断言 */
export function extractMetricStatements(
  report: EvaluableReport,
): MetricStatement[] {
  const out: MetricStatement[] = [];
  for (const section of report.sections) {
    for (const sentence of splitSentences(section.output)) {
      const term = METRIC_TERM.exec(sentence);
      const value = NUMERIC_VALUE.exec(sentence);
      if (!term || !value) continue;
      out.push({
        sectionId: section.agentId,
        sentence,
        term: term[1],
        value: value[0].replace(/\s+/g, ""),
      });
    }
  }
  return out;
}

/** 同一指标在两段里给出不同数值 → 矛盾 */
export function findContradictions(statements: MetricStatement[]): Array<{
  term: string;
  a: MetricStatement;
  b: MetricStatement;
}> {
  const byTerm = new Map<string, MetricStatement[]>();
  for (const st of statements) {
    const list = byTerm.get(st.term) ?? [];
    list.push(st);
    byTerm.set(st.term, list);
  }

  const conflicts: Array<{ term: string; a: MetricStatement; b: MetricStatement }> = [];
  for (const [term, list] of byTerm) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.sectionId === b.sectionId) continue; // 同一段内先不判矛盾
        if (a.value !== b.value) conflicts.push({ term, a, b });
      }
    }
  }
  return conflicts;
}

const hasSourcedVerified = (section: EvaluableSection) =>
  (section.evidence ?? []).some(
    (e) => e.label === "verified" && !!e.source && e.source.trim() !== "",
  );

const isTraceable = (evidence: Evidence, inputText: string) => {
  const source = evidence.source?.trim();
  if (!source) return false;
  if (!inputText) return true; // 没给核验语料时只校验「有来源」
  return inputText.includes(source);
};

/**
 * 红队检查。
 *
 * @param inputText 核验语料（本次用户输入）。给了它才能判断「来源是否真出自本次输入」；
 *   不给则退化为只校验「有没有来源」。
 */
export function runRedTeam(
  report: EvaluableReport,
  options: { inputText?: string } = {},
): RedTeamReport {
  const inputText = options.inputText ?? "";
  const findings: RedTeamFinding[] = [];

  // ① 虚构引用：verified 无来源，或来源不在核验语料里
  const fabricated: RedTeamDowngrade[] = [];
  const fabricatedClaims: string[] = [];
  report.sections.forEach((section) => {
    (section.evidence ?? []).forEach((evidence, index) => {
      if (evidence.label !== "verified") return;
      if (isTraceable(evidence, inputText)) return;
      const reason = evidence.source?.trim()
        ? `来源「${evidence.source.trim()}」无法在本次输入中核验`
        : "标记为「已核实」但没有任何来源";
      fabricated.push({
        sectionId: section.agentId,
        evidenceIndex: index,
        claim: evidence.claim,
        from: "verified",
        to: "inferred",
        reason,
      });
      fabricatedClaims.push(evidence.claim);
    });
  });
  if (fabricated.length > 0) {
    findings.push({
      kind: "fabricated_citation",
      severity: "blocked",
      sectionId: null,
      detail: `拦截 ${fabricated.length} 条无法核验的「已核实」：${fabricatedClaims
        .slice(0, 3)
        .join("；")}${fabricatedClaims.length > 3 ? " 等" : ""}`,
      downgrades: fabricated,
    });
  }

  // ② 虚构数值：段内有具体指标数字，却拿不出任何可追溯来源
  const statements = extractMetricStatements(report);
  const unsupported: RedTeamDowngrade[] = [];
  const unsupportedSections = new Set<string>();
  for (const st of statements) {
    const section = report.sections.find((s) => s.agentId === st.sectionId);
    if (!section || hasSourcedVerified(section)) continue;
    if (unsupportedSections.has(st.sectionId)) continue;
    unsupportedSections.add(st.sectionId);
    // 该段没有可追溯来源却报出具体数值 —— 段内「已核实」需降为缺失
    (section.evidence ?? []).forEach((evidence, index) => {
      if (evidence.label !== "verified") return;
      unsupported.push({
        sectionId: st.sectionId,
        evidenceIndex: index,
        claim: evidence.claim,
        from: "verified",
        to: "missing",
        reason: `该段出现具体数值（${st.term} ${st.value}）但无可追溯来源`,
      });
    });
  }
  if (unsupportedSections.size > 0) {
    findings.push({
      kind: "unsupported_metric",
      severity: unsupported.length > 0 ? "blocked" : "flagged",
      sectionId: [...unsupportedSections].join(","),
      detail: `拦截 ${unsupportedSections.size} 个「报了具体数值却无来源」的段落：${[
        ...unsupportedSections,
      ].join("、")}`,
      downgrades: unsupported,
    });
  }

  // ③ 自相矛盾：同一指标在不同段给出不同数值
  const contradictions = findContradictions(statements);
  const contradictionDowngrades: RedTeamDowngrade[] = [];
  for (const conflict of contradictions) {
    for (const side of [conflict.a, conflict.b]) {
      const section = report.sections.find((s) => s.agentId === side.sectionId);
      if (!section || hasSourcedVerified(section)) continue;
      (section.evidence ?? []).forEach((evidence, index) => {
        if (evidence.label !== "verified") return;
        contradictionDowngrades.push({
          sectionId: side.sectionId,
          evidenceIndex: index,
          claim: evidence.claim,
          from: "verified",
          to: "missing",
          reason: `「${conflict.term}」在两段给出不同数值（${conflict.a.value} vs ${conflict.b.value}）且无可核实来源`,
        });
      });
    }
  }
  if (contradictions.length > 0) {
    findings.push({
      kind: "contradiction",
      severity: contradictionDowngrades.length > 0 ? "blocked" : "flagged",
      sectionId: null,
      detail:
        `发现 ${contradictions.length} 处矛盾事实：` +
        contradictions
          .slice(0, 3)
          .map((c) => `${c.term}「${c.a.value}」(${c.a.sectionId}) vs 「${c.b.value}」(${c.b.sectionId})`)
          .join("；"),
      downgrades: contradictionDowngrades,
    });
  }

  // 同一 (段, 证据) 可能被多条规则命中：保留更重的一次（missing > inferred），避免重复计数
  const downgradeMap = new Map<string, RedTeamDowngrade>();
  for (const d of [...fabricated, ...unsupported, ...contradictionDowngrades]) {
    const key = `${d.sectionId}#${d.evidenceIndex}`;
    const existing = downgradeMap.get(key);
    if (!existing || (existing.to === "inferred" && d.to === "missing")) {
      downgradeMap.set(key, d);
    }
  }
  const downgrades = [...downgradeMap.values()];

  return {
    findings,
    blockedCount: downgrades.length,
    downgrades,
  };
}

/** 应用拦截结果：返回证据标签已被降级的新报告（不改入参） */
export function sanitizeReport(
  report: EvaluableReport,
  redTeam: RedTeamReport,
): EvaluableReport {
  if (redTeam.downgrades.length === 0) return report;

  const bySection = new Map<string, Map<number, EvidenceLabel>>();
  for (const d of redTeam.downgrades) {
    const inner = bySection.get(d.sectionId) ?? new Map<number, EvidenceLabel>();
    inner.set(d.evidenceIndex, d.to);
    bySection.set(d.sectionId, inner);
  }

  return {
    ...report,
    sections: report.sections.map((section) => {
      const patch = bySection.get(section.agentId);
      if (!patch || !section.evidence) return section;
      return {
        ...section,
        evidence: section.evidence.map((evidence, index) => {
          const to = patch.get(index);
          return to ? { ...evidence, label: to } : evidence;
        }),
      };
    }),
  };
}
