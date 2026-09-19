"use client";

import type { CapabilitySource } from "@/lib/components/types";
import { ANALYZE_STATUS_LABEL, canAnalyze, type AnalyzeState } from "@/lib/components/analysis/status";

/**
 * 截图分析面板（阶段 15，spec §8）。
 *
 * 纯展示：状态与副作用由工作区持有（`analyzeReducer` + `runAnalysis`）。
 * 这里只负责选图、显示状态机进度、触发 Analyze。
 */

export interface AnalyzePanelProps {
  state: AnalyzeState;
  /** 分析完成后标注能力来源（REAL / DEMO / MOCK） */
  source?: CapabilitySource;
  onSelectFile: (file: File) => void;
  onAnalyze: () => void;
  onReset: () => void;
}

export function AnalyzePanel({ state, source, onSelectFile, onAnalyze, onReset }: AnalyzePanelProps) {
  const busy = state.status === "analyzing" || state.status === "building";
  const ready = state.status === "ready";

  return (
    <section
      data-analyze-panel
      className="flex w-72 shrink-0 flex-col gap-2 overflow-auto rounded-xl border border-gray-200 p-3 text-xs dark:border-gray-800"
    >
      <span className="font-medium text-gray-500 dark:text-gray-400">截图分析</span>

      <input
        data-analyze-input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelectFile(file);
        }}
        className="block w-full text-[11px] text-gray-500 file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs dark:file:bg-gray-800 dark:file:text-gray-200"
      />

      {state.imageDataUrl && (
        // 截图预览：来源是用户本机文件
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-analyze-preview
          src={state.imageDataUrl}
          alt={state.fileName ?? "截图预览"}
          className="max-h-40 w-full rounded border border-gray-200 object-contain dark:border-gray-800"
        />
      )}

      <p data-analyze-status data-status={state.status} className="text-gray-500 dark:text-gray-400">
        {ANALYZE_STATUS_LABEL[state.status]}
      </p>

      {ready && source && (
        <span
          data-analyze-source
          className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${
            source === "real"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {source === "real" ? "REAL 分析" : `${source.toUpperCase()} 分析`}
        </span>
      )}

      {state.error && (
        <p
          data-analyze-error
          className="rounded border border-red-300 bg-red-50 p-2 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-analyze-run
          disabled={!canAnalyze(state) || busy}
          onClick={onAnalyze}
          className="rounded bg-indigo-600 px-3 py-1 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "分析中…" : "分析"}
        </button>
        <button
          type="button"
          data-analyze-reset
          onClick={onReset}
          className="rounded border border-gray-300 px-2 py-1 dark:border-gray-700"
        >
          重置
        </button>
      </div>
    </section>
  );
}
