import { runAnalysis } from "@/lib/agents/orchestrator";
import {
  createDefaultAgents,
  DEFAULT_PARALLEL_AGENT_IDS,
} from "@/lib/agents/analysis-stream";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import type { AgentResult } from "@/lib/types/agent";
import type { ProductBrief } from "@/lib/types/brief";
import type { LLMProvider } from "@/lib/llm/provider";
import { overallScore } from "./rubric";
import { buildJudgeMessages, parseJudgeOutput } from "./judge";
import type { EvalRun, EvalSampleResult } from "./baseline";

/**
 * 质量门禁 eval —— 运行编排。
 *
 * 对每个 golden brief：跑一遍完整编队得到报告 → 交给 judge 打分 → 汇聚为 EvalRun。
 * 编队与 judge 都通过注入的 provider 运行，使本模块可脱离网络单测。
 */

const TITLE_BY_AGENT = new Map(
  REPORT_SECTIONS.map((s) => [s.agentId, s.title]),
);

/** 把编队各段拼成给 judge 的报告全文（用报告段的展示标题，而非英文 agent id） */
export function renderReportText(results: AgentResult[]): string {
  return results
    .filter((r) => !r.failed && r.output.trim() !== "")
    .map((r) => `## ${TITLE_BY_AGENT.get(r.agentId) ?? r.agentId}\n\n${r.output}`)
    .join("\n\n");
}

export interface RunEvalOptions {
  briefs: { id: string; brief: ProductBrief }[];
  /** 跑编队用的 provider */
  analysisProvider: LLMProvider;
  /** 评审用的 provider（可与 analysisProvider 相同） */
  judgeProvider: LLMProvider;
  /** 写入 EvalRun.model 的模型标识 */
  modelLabel?: string;
  /** 注入时钟（测试可确定化 createdAt） */
  now?: () => string;
}

export async function runEval(options: RunEvalOptions): Promise<EvalRun> {
  const { briefs, analysisProvider, judgeProvider } = options;
  const results: EvalSampleResult[] = [];

  for (const { id, brief } of briefs) {
    const agentResults = await runAnalysis(
      brief,
      {
        provider: analysisProvider,
        agents: createDefaultAgents(),
        parallel: DEFAULT_PARALLEL_AGENT_IDS,
      },
      () => {},
    );

    const reportText = renderReportText(agentResults);
    const judged = await judgeProvider.chat(
      buildJudgeMessages({ id, name: brief.name, reportText }),
      { responseFormat: "json" },
    );
    const verdict = parseJudgeOutput(judged.content);
    const scores = verdict?.scores ?? {};

    results.push({
      id,
      name: brief.name,
      scores,
      overall: overallScore(scores),
    });
  }

  return {
    createdAt: options.now?.() ?? new Date().toISOString(),
    model: options.modelLabel ?? "",
    results,
  };
}
