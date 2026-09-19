import type { CapabilitySource, ComponentTree } from "../types";

/**
 * 界面分析 Provider 抽象（阶段 15，spec §9 / §10）。
 *
 * 数据流固定为：Image → Analysis Provider → Structured Component Tree。
 * 上层（工作区）只依赖这个接口；换成真正的 Vision 模型时，画布层完全不动。
 *
 * **真实性纪律**：`source` 必须如实标注是 REAL 还是 DEMO，绝不把 fixture
 * 伪装成真实 AI 分析。
 */

export interface AnalysisInput {
  /** 图片 data URL（png / jpeg / webp） */
  imageDataUrl: string;
  mimeType: string;
  /** 原始文件名（仅用于命名/展示，不是契约） */
  fileName?: string;
}

export interface AnalysisResult {
  /** 归一后的结构化组件树 */
  tree: ComponentTree;
  /** 分析能力来源（REAL / DEMO / MOCK） */
  source: CapabilitySource;
  /** 页面名（作为项目名的建议值） */
  pageName: string;
  /** 可选：模型给出的整体说明 */
  summary?: string;
}

export interface AnalysisProvider {
  readonly id: string;
  /** 能力来源，供 UI 标注 */
  readonly source: CapabilitySource;
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}
