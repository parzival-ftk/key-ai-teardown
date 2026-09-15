"use client";

import type {
  DiffChangeKind,
  ReportDiffResult,
  TextDiffLine,
} from "@/lib/compare/report-diff";

/**
 * 报告差异视图（W21）。
 *
 * 两种模式：
 * - `unified`：单栏内联，变更行就地标注（新增浅绿、删除浅红删除线）；
 * - `split`：双栏并排，变更块按行配对（左=base 被删的行，右=compare 新增的行）。
 *
 * 纯展示组件：diff 结果由 `lib/compare/report-diff` 算好传入，组件不重复计算口径。
 */

export type DiffViewMode = "split" | "unified";

export interface DiffCell {
  text: string;
  type: "unchanged" | "added" | "removed";
  /** 该行在对应侧原文中的行号（1 起） */
  line: number | null;
}

export interface SplitRow {
  left: DiffCell | null;
  right: DiffCell | null;
}

/**
 * 内联 diff 行 → 双栏行。
 *
 * 关键在**变更块配对**：连续的变更行按 removed / added 分列后逐行对齐，
 * 使「改一行」呈现为同一行的左右对照，而不是上下两条互不相干的记录。
 */
export function toSplitRows(lines: TextDiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.type === "unchanged") {
      rows.push({
        left: { text: line.text, type: "unchanged", line: line.baseLine },
        right: { text: line.text, type: "unchanged", line: line.compareLine },
      });
      i++;
      continue;
    }

    const removed: DiffCell[] = [];
    const added: DiffCell[] = [];
    while (i < lines.length && lines[i].type !== "unchanged") {
      const current = lines[i];
      if (current.type === "removed") {
        removed.push({ text: current.text, type: "removed", line: current.baseLine });
      } else {
        added.push({ text: current.text, type: "added", line: current.compareLine });
      }
      i++;
    }

    const pairs = Math.max(removed.length, added.length);
    for (let k = 0; k < pairs; k++) {
      rows.push({ left: removed[k] ?? null, right: added[k] ?? null });
    }
  }

  return rows;
}

const STATUS_LABEL: Record<DiffChangeKind, string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  unchanged: "未变",
};

const STATUS_CLASS: Record<DiffChangeKind, string> = {
  added: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  removed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  modified: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unchanged: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/** 变更行的视觉：新增浅绿、删除浅红 + 删除线 */
const LINE_CLASS: Record<DiffCell["type"], string> = {
  added: "bg-green-50 text-green-900 dark:bg-green-950/50 dark:text-green-200",
  removed:
    "bg-red-50 text-red-900 line-through decoration-red-400 dark:bg-red-950/50 dark:text-red-200",
  unchanged: "text-gray-700 dark:text-gray-300",
};

function StatusBadge({ status }: { status: DiffChangeKind }) {
  return (
    <span
      data-diff-status-badge={status}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export interface HistoryDiffViewProps {
  diff: ReportDiffResult;
  mode?: DiffViewMode;
  /** 是否展示未变更行（关闭后只留变更，长报告更易读） */
  showUnchanged?: boolean;
}

export function HistoryDiffView({
  diff,
  mode = "unified",
  showUnchanged = true,
}: HistoryDiffViewProps) {
  return (
    <div data-diff-view data-diff-mode={mode} className="flex flex-col gap-4">
      {diff.sections.map((section) => {
        const lines = showUnchanged
          ? section.lines
          : section.lines.filter((l) => l.type !== "unchanged");
        const rows = showUnchanged
          ? toSplitRows(section.lines)
          : toSplitRows(section.lines).filter(
              (r) => r.left?.type !== "unchanged" || r.right?.type !== "unchanged",
            );

        return (
          <section
            key={section.agentId}
            data-diff-section={section.agentId}
            data-diff-section-status={section.status}
            className="rounded-lg border border-gray-200 dark:border-gray-800"
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
              <span className="text-sm font-medium">{section.name}</span>
              <StatusBadge status={section.status} />
              {section.stats.added > 0 && (
                <span data-diff-stats-added className="font-mono text-[11px] text-green-700 dark:text-green-400">
                  +{section.stats.added}
                </span>
              )}
              {section.stats.removed > 0 && (
                <span data-diff-stats-removed className="font-mono text-[11px] text-red-700 dark:text-red-400">
                  -{section.stats.removed}
                </span>
              )}
              {section.confidenceDelta !== null && section.confidenceDelta !== 0 && (
                <span data-diff-confidence className="font-mono text-[11px] text-gray-500">
                  置信度 {section.confidenceDelta > 0 ? "+" : ""}
                  {section.confidenceDelta}
                </span>
              )}
            </header>

            {section.dimensionDeltas.length > 0 && (
              <ul data-diff-dimensions className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
                {section.dimensionDeltas.map((d) => (
                  <li
                    key={d.id}
                    data-diff-dimension={d.id}
                    data-diff-dimension-delta={d.delta ?? ""}
                    className="flex items-center gap-1"
                  >
                    <span className="text-gray-500 dark:text-gray-400">{d.label}</span>
                    <span className="font-mono">
                      {d.base ?? "—"} → {d.compare ?? "—"}
                    </span>
                    {d.delta !== null && d.delta !== 0 && (
                      <span
                        className={`font-mono ${
                          d.delta > 0
                            ? "text-green-700 dark:text-green-400"
                            : "text-red-700 dark:text-red-400"
                        }`}
                      >
                        {d.delta > 0 ? "▲" : "▼"}
                        {Math.abs(d.delta)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {section.mermaid.length > 0 && (
              <ul data-diff-mermaids className="flex flex-wrap gap-2 px-3 pb-2 text-[11px]">
                {section.mermaid.map((m) => (
                  <li
                    key={m.index}
                    data-diff-mermaid={m.index}
                    data-diff-mermaid-status={m.status}
                    className={`rounded px-2 py-0.5 ${STATUS_CLASS[m.status]}`}
                  >
                    图谱 #{m.index + 1} · {STATUS_LABEL[m.status]}
                  </li>
                ))}
              </ul>
            )}

            {lines.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">
                该段无变更{showUnchanged ? "" : "可显示"}
              </p>
            ) : mode === "unified" ? (
              <pre data-diff-unified className="overflow-x-auto px-3 py-2 text-xs leading-relaxed">
                <code>
                  {lines.map((line, index) => (
                    <div
                      key={index}
                      data-diff-line
                      data-diff-type={line.type}
                      className={`whitespace-pre-wrap break-words px-1 ${LINE_CLASS[line.type]}`}
                    >
                      <span className="mr-2 select-none font-mono text-[10px] text-gray-400">
                        {line.baseLine ?? ""}
                        {"\t"}
                        {line.compareLine ?? ""}
                      </span>
                      {line.text}
                    </div>
                  ))}
                </code>
              </pre>
            ) : (
              <div data-diff-split className="grid grid-cols-2 gap-px text-xs leading-relaxed">
                {rows.map((row, index) => (
                  <div key={index} data-diff-split-row className="contents">
                    {[row.left, row.right].map((cell, side) => (
                      <div
                        key={side}
                        data-diff-cell={side === 0 ? "base" : "compare"}
                        data-diff-cell-type={cell?.type ?? "empty"}
                        className={`overflow-x-auto whitespace-pre-wrap break-words px-2 py-0.5 ${
                          cell ? LINE_CLASS[cell.type] : "bg-gray-50 dark:bg-gray-900/40"
                        }`}
                      >
                        <span className="mr-2 select-none font-mono text-[10px] text-gray-400">
                          {cell?.line ?? ""}
                        </span>
                        {cell?.text ?? ""}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {diff.sections.length === 0 && (
        <p className="text-sm text-gray-400">两份报告都没有可比较的段落。</p>
      )}
    </div>
  );
}
