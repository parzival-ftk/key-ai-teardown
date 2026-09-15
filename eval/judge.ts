/**
 * 质量门禁 eval —— judge（**转发模块**）。
 *
 * W14 起评审逻辑上移到 `lib/eval/judgeAgent.ts`：那里同时提供
 * - 启发式评分 `scoreEvaluation`（在线看板用，无 LLM、确定性）
 * - LLM-as-a-judge 的 `buildJudgeMessages` / `parseJudgeOutput`（离线 eval 用）
 * 本文件保留原有导出名，供既有调用方无痛迁移。
 */

export {
  buildJudgeMessages,
  parseJudgeOutput,
  type JudgeSample,
  type JudgeVerdict,
} from "@/lib/eval/judgeAgent";
