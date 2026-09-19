import { describe, it, expect } from "vitest";
import {
  INITIAL_ANALYZE_STATE,
  analyzeReducer,
  canAnalyze,
  type AnalyzeState,
} from "./status";
import { toAnalysisInput } from "./image-input";
import { runAnalysis } from "./service";
import { createDemoAnalysisProvider } from "./demo-provider";
import type { AnalysisProvider } from "./provider";
import { treeFromRaw } from "../tree";
import { hasCompleteRects } from "../layout";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("analyzeReducer", () => {
  it("按 idle → uploading → analyzing → building → ready 迁移", () => {
    let state: AnalyzeState = INITIAL_ANALYZE_STATE;
    state = analyzeReducer(state, { type: "select", imageDataUrl: PNG_DATA_URL, mimeType: "image/png" });
    expect(state.status).toBe("uploading");
    state = analyzeReducer(state, { type: "analyze" });
    expect(state.status).toBe("analyzing");
    state = analyzeReducer(state, { type: "build" });
    expect(state.status).toBe("building");
    state = analyzeReducer(state, { type: "ready" });
    expect(state.status).toBe("ready");
  });

  it("失败转 error 并保留已选图片（可重试）", () => {
    const selected = analyzeReducer(INITIAL_ANALYZE_STATE, {
      type: "select",
      imageDataUrl: PNG_DATA_URL,
      mimeType: "image/png",
    });
    const failed = analyzeReducer(analyzeReducer(selected, { type: "analyze" }), {
      type: "fail",
      error: "分析失败",
    });
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("分析失败");
    expect(failed.imageDataUrl).toBe(PNG_DATA_URL);
  });

  it("未选图时不进入 analyzing", () => {
    expect(analyzeReducer(INITIAL_ANALYZE_STATE, { type: "analyze" }).status).toBe("idle");
  });

  it("reset 回到初始态", () => {
    const selected = analyzeReducer(INITIAL_ANALYZE_STATE, {
      type: "select",
      imageDataUrl: PNG_DATA_URL,
      mimeType: "image/png",
    });
    expect(analyzeReducer(selected, { type: "reset" })).toEqual(INITIAL_ANALYZE_STATE);
  });

  it("canAnalyze 需要已选图且不忙", () => {
    expect(canAnalyze(INITIAL_ANALYZE_STATE)).toBe(false);
    const selected = analyzeReducer(INITIAL_ANALYZE_STATE, {
      type: "select",
      imageDataUrl: PNG_DATA_URL,
      mimeType: "image/png",
    });
    expect(canAnalyze(selected)).toBe(true);
    expect(canAnalyze({ ...selected, status: "analyzing" })).toBe(false);
  });
});

describe("toAnalysisInput", () => {
  it("接受 PNG / JPG / WEBP", () => {
    expect(toAnalysisInput("data:image/png;base64,iVBORw0KGgo=").ok).toBe(true);
    expect(toAnalysisInput("data:image/jpeg;base64,/9j/4A==").ok).toBe(true);
    expect(toAnalysisInput("data:image/webp;base64,UklGRg==").ok).toBe(true);
  });

  it("拒绝非图片与非 base64 输入", () => {
    expect(toAnalysisInput("hello")).toMatchObject({ ok: false });
    const gif = toAnalysisInput("data:image/gif;base64,R0lGODlh");
    expect(gif.ok).toBe(false);
    if (!gif.ok) expect(gif.error).toContain("PNG / JPG / WEBP");
  });

  it("保留文件名", () => {
    const result = toAnalysisInput("data:image/png;base64,iVBORw0KGgo=", "shot.png");
    expect(result.ok && result.input.fileName).toBe("shot.png");
  });
});

describe("runAnalysis", () => {
  it("DEMO provider：返回结构化组件树并标注 demo", async () => {
    const result = await runAnalysis(
      { imageDataUrl: PNG_DATA_URL, mimeType: "image/png" },
      createDemoAnalysisProvider({ delayMs: 0 }),
    );
    expect(result.source).toBe("demo");
    expect(result.pageName).toBe("Dashboard");
    expect(Object.keys(result.tree.nodes).length).toBeGreaterThan(5);
    expect(result.tree.nodes[result.tree.rootId].name).toBe("Dashboard");
  });

  it("对缺矩形的 provider 输出自动补布局", async () => {
    const rectless: AnalysisProvider = {
      id: "rectless",
      source: "demo",
      async analyze() {
        return {
          tree: treeFromRaw({ name: "Page", children: [{ name: "Section" }] }),
          source: "demo",
          pageName: "Page",
        };
      },
    };
    const result = await runAnalysis({ imageDataUrl: PNG_DATA_URL, mimeType: "image/png" }, rectless);
    expect(hasCompleteRects(result.tree)).toBe(true);
  });

  it("demo provider 的产出带真实矩形（无需再布局）", async () => {
    const result = await runAnalysis(
      { imageDataUrl: PNG_DATA_URL, mimeType: "image/png" },
      createDemoAnalysisProvider({ delayMs: 0 }),
    );
    expect(hasCompleteRects(result.tree)).toBe(true);
  });
});
