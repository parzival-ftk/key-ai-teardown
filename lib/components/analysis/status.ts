/**
 * 截图分析的状态机（阶段 15，spec §8，纯函数）。
 *
 * idle → uploading → analyzing → building → ready，任一环节失败转 error。
 * 用 reducer 表达状态迁移：UI 只派发事件，迁移规则集中在此，便于单测。
 */

export type AnalyzeStatus =
  | "idle"
  | "uploading"
  | "analyzing"
  | "building"
  | "ready"
  | "error";

export interface AnalyzeState {
  status: AnalyzeStatus;
  /** 已选图片的 data URL（uploading 起就有） */
  imageDataUrl?: string;
  mimeType?: string;
  fileName?: string;
  /** error 状态下的失败原因 */
  error?: string;
}

export type AnalyzeEvent =
  | { type: "select"; imageDataUrl: string; mimeType: string; fileName?: string }
  | { type: "analyze" }
  | { type: "build" }
  | { type: "ready" }
  | { type: "fail"; error: string }
  | { type: "reset" };

export const INITIAL_ANALYZE_STATE: AnalyzeState = { status: "idle" };

/** 是否具备开始分析的条件（已选图、且当前不忙） */
export function canAnalyze(state: AnalyzeState): boolean {
  return Boolean(state.imageDataUrl) && state.status !== "analyzing" && state.status !== "building";
}

export function analyzeReducer(state: AnalyzeState, event: AnalyzeEvent): AnalyzeState {
  switch (event.type) {
    case "select":
      return {
        status: "uploading",
        imageDataUrl: event.imageDataUrl,
        mimeType: event.mimeType,
        ...(event.fileName ? { fileName: event.fileName } : {}),
      };
    case "analyze":
      if (!state.imageDataUrl) return state;
      return { ...state, status: "analyzing", error: undefined };
    case "build":
      if (!state.imageDataUrl) return state;
      return { ...state, status: "building", error: undefined };
    case "ready":
      return { ...state, status: "ready", error: undefined };
    case "fail":
      // 保留已选图片，用户可修正后重试
      return { ...state, status: "error", error: event.error };
    case "reset":
      return { ...INITIAL_ANALYZE_STATE };
    default:
      return state;
  }
}

export const ANALYZE_STATUS_LABEL: Record<AnalyzeStatus, string> = {
  idle: "选择一张产品界面截图（PNG / JPG / WEBP）",
  uploading: "已就绪，点击 Analyze 开始分析",
  analyzing: "分析中…",
  building: "构建组件树…",
  ready: "分析完成",
  error: "分析失败",
};
