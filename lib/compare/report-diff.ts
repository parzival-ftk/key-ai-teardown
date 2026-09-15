import { extractMermaidBlocks } from "@/lib/diagram/mermaid-blocks";
import {
  RADAR_DIMENSION_IDS,
  RADAR_LABEL_BY_ID,
} from "@/lib/report/radar-dimensions";

/**
 * W21 · 报告 Diff 引擎（零依赖纯函数）。
 *
 * 行级 diff 用**真 LCS**（动态规划 + 公共前后缀裁剪），而不是「整段替换」的近似：
 * 改一行必须只产出 1 条 removed + 1 条 added，否则读 diff 的人会被迫在几十行红绿里找那一处。
 *
 * 输入类型是**结构子集**（`DiffReport`），与 `components/report-view` 的 `ReportData` 结构兼容 ——
 * 这样 lib 层不必反向依赖 components 层；调用方直接把自己的报告对象传进来即可。
 *
 * 边界安全：缺 sections / 段落缺 output / 非数组 / 空对象一律按「空」处理，绝不抛错。
 */

/** 单段报告内容（结构子集，兼容 ReportData.sections 的元素） */
export interface DiffReportSection {
  agentId: string;
  name?: string;
  status?: string;
  output?: string;
  confidence?: number;
  dimensionScores?: Record<string, number>;
}

export interface DiffReport {
  name?: string;
  sections?: DiffReportSection[];
}

export type DiffChangeKind = "added" | "removed" | "unchanged" | "modified";

export interface TextDiffLine {
  type: "added" | "removed" | "unchanged";
  text: string;
  /** 在 base 中的行号（1 起）；added 行为 null */
  baseLine: number | null;
  /** 在 compare 中的行号（1 起）；removed 行为 null */
  compareLine: number | null;
}

export interface MermaidDiff {
  /** 在该段内的图谱序号（0 起） */
  index: number;
  status: DiffChangeKind;
  baseCode: string | null;
  compareCode: string | null;
}

export interface DimensionDelta {
  id: string;
  label: string;
  base: number | null;
  compare: number | null;
  /** compare − base；任一侧缺失为 null */
  delta: number | null;
}

export interface SectionDiff {
  agentId: string;
  name: string;
  status: DiffChangeKind;
  /** 行级 diff（LCS） */
  lines: TextDiffLine[];
  stats: { added: number; removed: number; unchanged: number };
  /** 置信度变化；任一侧缺省为 null */
  confidenceDelta: number | null;
  /** 该段内 Mermaid 围栏的逐块差异 */
  mermaid: MermaidDiff[];
  /** 竞品维度分变化；两侧都没有维度分时为空数组 */
  dimensionDeltas: DimensionDelta[];
}

export interface ReportDiffResult {
  baseName: string;
  compareName: string;
  sections: SectionDiff[];
  summary: { added: number; removed: number; modified: number; unchanged: number };
  hasChanges: boolean;
}

/* ---------------------------------- 行级 diff ---------------------------------- */

interface Op {
  type: "added" | "removed" | "unchanged";
  text: string;
  ai: number;
  bi: number;
}

function splitLines(text: string): string[] {
  const t = text ?? "";
  if (t === "") return [];
  return t.replace(/\n$/, "").split("\n");
}

/** 对已裁掉公共前后缀的中间段做 LCS，产出最基本的编辑操作序列 */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text, j) => ({ type: "added", text, ai: -1, bi: j }));
  if (m === 0) return a.map((text, i) => ({ type: "removed", text, ai: i, bi: -1 }));

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "unchanged", text: a[i], ai: i, bi: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "removed", text: a[i], ai: i, bi: -1 });
      i++;
    } else {
      ops.push({ type: "added", text: b[j], ai: -1, bi: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "removed", text: a[i], ai: i, bi: -1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: "added", text: b[j], ai: -1, bi: j });
    j++;
  }
  return ops;
}

/** 文本 → 行级 diff；两侧行号均可回溯到原文（1 起） */
export function diffTextLines(baseText: string, compareText: string): TextDiffLine[] {
  const a = splitLines(baseText);
  const b = splitLines(compareText);
  const out: TextDiffLine[] = [];

  // 公共前缀 / 后缀裁剪：既提速，也让「大段未变 + 少量改动」的行号推导更直观
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  for (let i = 0; i < start; i++) {
    out.push({ type: "unchanged", text: a[i], baseLine: i + 1, compareLine: i + 1 });
  }

  for (const op of lcsOps(a.slice(start, endA), b.slice(start, endB))) {
    if (op.type === "unchanged") {
      out.push({
        type: "unchanged",
        text: op.text,
        baseLine: start + op.ai + 1,
        compareLine: start + op.bi + 1,
      });
    } else if (op.type === "removed") {
      out.push({
        type: "removed",
        text: op.text,
        baseLine: start + op.ai + 1,
        compareLine: null,
      });
    } else {
      out.push({
        type: "added",
        text: op.text,
        baseLine: null,
        compareLine: start + op.bi + 1,
      });
    }
  }

  for (let k = 0; k < a.length - endA; k++) {
    out.push({
      type: "unchanged",
      text: a[endA + k],
      baseLine: endA + k + 1,
      compareLine: endB + k + 1,
    });
  }

  return out;
}

/* --------------------------------- 段落级 diff --------------------------------- */

function normalizeSections(report: DiffReport | null | undefined): DiffReportSection[] {
  const sections = report?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.filter(
    (s): s is DiffReportSection => !!s && typeof (s as DiffReportSection).agentId === "string",
  );
}

function countLines(lines: TextDiffLine[]) {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.type === "added") added++;
    else if (line.type === "removed") removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}

function diffMermaid(baseOutput: string, compareOutput: string): MermaidDiff[] {
  const baseBlocks = extractMermaidBlocks(baseOutput);
  const compareBlocks = extractMermaidBlocks(compareOutput);
  const total = Math.max(baseBlocks.length, compareBlocks.length);
  const out: MermaidDiff[] = [];
  for (let i = 0; i < total; i++) {
    const b = baseBlocks[i];
    const c = compareBlocks[i];
    if (b && c) {
      out.push({
        index: i,
        status: b.code === c.code ? "unchanged" : "modified",
        baseCode: b.code,
        compareCode: c.code,
      });
    } else if (b) {
      out.push({ index: i, status: "removed", baseCode: b.code, compareCode: null });
    } else if (c) {
      out.push({ index: i, status: "added", baseCode: null, compareCode: c.code });
    }
  }
  return out;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function diffDimensions(
  baseScores: Record<string, number> | undefined,
  compareScores: Record<string, number> | undefined,
): DimensionDelta[] {
  const keys = new Set([
    ...Object.keys(baseScores ?? {}),
    ...Object.keys(compareScores ?? {}),
  ]);
  if (keys.size === 0) return [];

  // 已知维度按单一事实来源排序，未知键（模型臆造）排在其后并稳定排序
  const ordered = [
    ...RADAR_DIMENSION_IDS.filter((id) => keys.has(id)),
    ...[...keys].filter((id) => !RADAR_DIMENSION_IDS.includes(id)).sort(),
  ];

  return ordered.map((id) => {
    const base = numOrNull(baseScores?.[id]);
    const compare = numOrNull(compareScores?.[id]);
    return {
      id,
      label: RADAR_LABEL_BY_ID[id] ?? id,
      base,
      compare,
      delta: base !== null && compare !== null ? compare - base : null,
    };
  });
}

/**
 * 比较两份报告：段落四态 + 行级 diff + Mermaid 图谱差异 + 竞品维度分变化。
 * 段落顺序以 base 为准，仅在 compare 中出现的段落追加在后。
 */
export function diffReports(
  baseReport: DiffReport | null | undefined,
  compareReport: DiffReport | null | undefined,
): ReportDiffResult {
  const baseSections = normalizeSections(baseReport);
  const compareSections = normalizeSections(compareReport);
  const baseMap = new Map(baseSections.map((s) => [s.agentId, s]));
  const compareMap = new Map(compareSections.map((s) => [s.agentId, s]));

  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of [...baseSections, ...compareSections]) {
    if (!seen.has(s.agentId)) {
      seen.add(s.agentId);
      order.push(s.agentId);
    }
  }

  const sections: SectionDiff[] = order.map((agentId) => {
    const base = baseMap.get(agentId);
    const compare = compareMap.get(agentId);
    const baseOutput = base?.output ?? "";
    const compareOutput = compare?.output ?? "";
    const lines = diffTextLines(baseOutput, compareOutput);
    const mermaid = diffMermaid(baseOutput, compareOutput);
    const dimensionDeltas = diffDimensions(
      base?.dimensionScores,
      compare?.dimensionScores,
    );

    let status: DiffChangeKind;
    if (!base) status = "added";
    else if (!compare) status = "removed";
    else {
      const contentChanged =
        baseOutput !== compareOutput ||
        dimensionDeltas.some(
          (d) => d.delta !== 0 || d.base === null || d.compare === null,
        );
      status = contentChanged ? "modified" : "unchanged";
    }

    const confidenceDelta =
      typeof base?.confidence === "number" && typeof compare?.confidence === "number"
        ? compare.confidence - base.confidence
        : null;

    return {
      agentId,
      name: compare?.name ?? base?.name ?? agentId,
      status,
      lines,
      stats: countLines(lines),
      confidenceDelta,
      mermaid,
      dimensionDeltas,
    };
  });

  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const s of sections) summary[s.status]++;

  return {
    baseName: baseReport?.name ?? "",
    compareName: compareReport?.name ?? "",
    sections,
    summary,
    hasChanges:
      summary.added + summary.removed + summary.modified > 0,
  };
}
