/**
 * 质量门禁 eval —— CLI 入口。
 *
 * 用法（见 package.json 的 eval 脚本）：
 *   npm run eval                     # 跑一遍，与 eval/baseline.json 对比
 *   npm run eval -- --update-baseline # 跑完把当前结果写为新基线
 *   npm run eval -- --baseline <path> # 指定基线文件
 *
 * 需要真实 LLM（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）；未配置时给出指引并以非零码退出。
 * 注意：judge 是代理指标、有噪音，分数只用于同一 rubric 下的相对比较，不得当真理。
 */

import fs from "node:fs";
import path from "node:path";
import { createProviderFromEnv, LLMConfigError } from "@/lib/config";
import type { LLMProvider } from "@/lib/llm/provider";
import { GOLDEN_BRIEFS } from "./briefs";
import { runEval } from "./run";
import { compareRuns, parseRun, serializeRun } from "./baseline";
import { renderComparisonTable, renderRunSummary } from "./report";

const DEFAULT_BASELINE_PATH = path.resolve(import.meta.dirname, "baseline.json");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

function resolveProvider(): LLMProvider | null {
  try {
    return createProviderFromEnv();
  } catch (err) {
    const message =
      err instanceof LLMConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`[eval] 无法启动：${message}`);
    console.error(
      "[eval] 质量门禁需要真实 LLM —— 请复制 .env.example 为 .env，填入 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 后重试。",
    );
    return null;
  }
}

async function main(): Promise<void> {
  const updateBaseline = process.argv.includes("--update-baseline");
  const baselinePath = argValue("--baseline") ?? DEFAULT_BASELINE_PATH;

  const provider = resolveProvider();
  if (!provider) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `[eval] 运行 ${GOLDEN_BRIEFS.length} 个 golden brief（模型：${provider.model}）…`,
  );
  const run = await runEval({
    briefs: GOLDEN_BRIEFS,
    analysisProvider: provider,
    judgeProvider: provider,
    modelLabel: provider.model,
  });

  const baselineRaw = fs.existsSync(baselinePath)
    ? fs.readFileSync(baselinePath, "utf8")
    : null;
  const baseline = parseRun(baselineRaw);

  console.log("");
  console.log(renderRunSummary(run));
  console.log("");
  console.log(renderComparisonTable(compareRuns(run, baseline)));
  if (!baseline) {
    console.log("");
    console.log(
      "[eval] 未找到基线（首次运行）。用 --update-baseline 把本次结果存为基线，下次即可看变化。",
    );
  }

  if (updateBaseline) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${serializeRun(run)}\n`, "utf8");
    console.log("");
    console.log(`[eval] 已更新基线：${baselinePath}`);
  }
}

main().catch((err) => {
  console.error("[eval] 运行失败：", err);
  process.exitCode = 1;
});
