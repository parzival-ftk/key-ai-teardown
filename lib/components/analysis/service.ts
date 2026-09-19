import { ensureRects } from "../layout";
import type { AnalysisProvider, AnalysisResult } from "./provider";
import { createDemoAnalysisProvider } from "./demo-provider";

/**
 * 分析服务（阶段 15）。
 *
 * 工作区只调这里，不直接调 provider —— 服务负责：选定 provider、**保证 rect 完整**
 * （缺矩形时布局），以及未来接入真实 Vision 模型时的替换点。
 *
 * 当前默认 provider 是 DEMO（如实标注）。接入真机时改 `defaultAnalysisProvider` 即可，
 * 画布与 Inspector 完全不动。
 */

export function defaultAnalysisProvider(): AnalysisProvider {
  return createDemoAnalysisProvider();
}

/** 跑一次分析；返回归一后的结构化组件树 */
export async function runAnalysis(
  input: Parameters<AnalysisProvider["analyze"]>[0],
  provider: AnalysisProvider = defaultAnalysisProvider(),
): Promise<AnalysisResult> {
  const result = await provider.analyze(input);
  return { ...result, tree: ensureRects(result.tree) };
}
