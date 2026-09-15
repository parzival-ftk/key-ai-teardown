/**
 * 质量门禁 eval —— CLI 核心逻辑（W14 起由 scripts/run-eval.ts 调用）。
 *
 * 用法（见 package.json 的 eval 脚本）：
 *   npm run eval                        # 跑一遍，输出终端质量评估表 + 门禁判定
 *   npm run eval -- --threshold 75      # 覆盖门禁阈值（默认 80）
 *   npm run eval -- --update-baseline   # 跑完把当前结果写为新基线
 *   npm run eval -- --baseline <path>   # 指定基线文件
 *
 * 需要 LLM（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）；把 BASE_URL 指向 e2e/stub-llm-server.mjs
 * 即可零成本演练（此时 judge 拿不到结构化输出，分数会很低、门禁不过 —— 这是预期行为）。
 *
 * 纪律：judge 与启发式评分都是**代理指标**，分数只用于同一 rubric 下的相对比较，不得当真理。
 */

import fs from "node:fs";
import path from "node:path";
import { createProviderFromEnv, LLMConfigError } from "@/lib/config";
import { DEFAULT_GATE_THRESHOLD } from "@/lib/eval/dimensions";
import type { LLMProvider } from "@/lib/llm/provider";
import { GOLDEN_BRIEFS } from "./briefs";
import { runEval } from "./run";
import { compareRuns, parseRun, serializeRun } from "./baseline";
import {
  qualityGate,
  renderComparisonTable,
  renderQualityTable,
  renderRunSummary,
} from "./report";

const DEFAULT_BASELINE_PATH = path.resolve(import.meta.dirname, "baseline.json");

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
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
      "[eval] 质量门禁需要 LLM —— 请复制 .env.example 为 .env，填入 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL；或把 BASE_URL 指向 e2e/stub-llm-server.mjs 演练。",
    );
    return null;
  }
}

/** 返回进程退出码：门禁通过 0，未通过或无法运行 1 */
export async function runEvalCli(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const updateBaseline = argv.includes("--update-baseline");
  const baselinePath = argValue(argv, "--baseline") ?? DEFAULT_BASELINE_PATH;
  const parsedThreshold = Number(argValue(argv, "--threshold"));
  const threshold = Number.isFinite(parsedThreshold)
    ? parsedThreshold
    : DEFAULT_GATE_THRESHOLD;

  const provider = resolveProvider();
  if (!provider) return 1;

  console.log(
    `[eval] 运行 ${GOLDEN_BRIEFS.length} 个 golden brief（模型：${provider.model}）…`,
  );
  const run = await runEval({
    briefs: GOLDEN_BRIEFS,
    analysisProvider: provider,
    judgeProvider: provider,
    modelLabel: provider.model,
  });

  console.log("");
  console.log(renderRunSummary(run));
  console.log("");
  console.log(renderQualityTable(run, threshold));

  const baseline = parseRun(
    fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, "utf8") : null,
  );
  console.log("");
  console.log("与基线对比：");
  console.log(renderComparisonTable(compareRuns(run, baseline)));
  if (!baseline) {
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

  const gate = qualityGate(run, threshold);
  console.log("");
  console.log(
    gate.passed
      ? `[eval] 门禁通过：平均 ${gate.average} 分 ≥ 阈值 ${threshold}`
      : `[eval] 门禁未通过：平均 ${gate.average} 分 < 阈值 ${threshold}${
          gate.failedSamples.length
            ? `，且 ${gate.failedSamples.join("、")} 未达标`
            : ""
        }`,
  );
  return gate.passed ? 0 : 1;
}
