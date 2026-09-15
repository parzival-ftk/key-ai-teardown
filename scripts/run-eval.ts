/**
 * 质量门禁 CLI 入口（W14）。
 *
 *   npm run eval                       # 终端质量评估表 + 门禁判定（阈值默认 80）
 *   npm run eval -- --threshold 75
 *   npm run eval -- --update-baseline
 *
 * 逻辑在 eval/cli.ts（可单测），这里只做入口与退出码接线。
 * 运行方式见 package.json：用 Node 原生 TS + eval/register.mjs（把 @/ 别名映射到仓库根）。
 */

import { runEvalCli } from "@/eval/cli";

runEvalCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("[eval] 运行失败：", err);
    process.exitCode = 1;
  });
