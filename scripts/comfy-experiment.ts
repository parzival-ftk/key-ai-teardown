/**
 * ComfyUI 生成质量实验 CLI（阶段 13 建，阶段 14 扩展为批量）。
 *
 * 职责单一：用**给定参数**真实生成图片，并把可追溯的 metadata 追加到 JSONL。
 * 生成一律走 `ComfyUIProvider`（**不**自己请求 `/prompt`）；本文件只额外读一次
 * `/object_info` 用来选默认 checkpoint —— 那是只读自省，不是生成路径。
 *
 * 用法：
 *   npm run comfy:experiment -- --list
 *   npm run comfy:experiment -- --case=case-01 --tag=baseline          # 单次
 *   npm run comfy:experiment -- --cases=case-01,case-02 --seeds=1,2,3  # 批量（笛卡尔积）
 *   npm run comfy:experiment -- --cases=case-01 --seeds=123456 --sampler=dpmpp_2m --exp=exp1-dpmpp2m
 *
 * 单变量原则：调用方一次只改一个参数，其余走基线默认（`EXPERIMENT_BASELINE`）。
 * 批量时每张图的 filenamePrefix 含 `exp-caseseed`，保证文件名可反查参数。
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readComfyUIEnv } from "@/lib/config";
import { getAvailableCheckpoints, type ComfyObjectInfo } from "@/lib/canvas/comfy-doctor";
import { createComfyUIProviderFromEnv } from "@/lib/image/comfyui-provider";
import { ImageGenError } from "@/lib/image/provider";

/* ── 固定测试集（不要每次改 prompt，否则无法比较） ── */

export const EXPERIMENT_CASES: ReadonlyArray<{ id: string; prompt: string }> = [
  { id: "case-01", prompt: "一只坐在窗台上的猫" },
  { id: "case-02", prompt: "一只橘猫坐在室内窗台上，窗外是城市夜景" },
  { id: "case-03", prompt: "一张木桌上放着一个红色苹果和一本打开的书" },
  { id: "case-04", prompt: "一个穿黑色夹克的男人站在雨夜街道上" },
  { id: "case-05", prompt: "一只白色猫咪，室内暖光，电影感摄影" },
];

/** 当前基线（= 代码默认值；改这里就等于改「基线」，实验时不要动） */
export const EXPERIMENT_BASELINE = {
  seed: 123456,
  steps: 20,
  cfg: 7.5,
  sampler: "euler",
  scheduler: "normal",
  width: 512,
  height: 512,
} as const;

/* ── 参数 ── */

const argOf = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const numArg = (name: string, fallback: number): number => {
  const raw = argOf(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

/** 解析 `a,b,c` 形式的列表参数 */
const listArg = (name: string): string[] =>
  (argOf(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function main(): Promise<number> {
  if (process.argv.includes("--list")) {
    console.log("\n固定测试集：");
    for (const item of EXPERIMENT_CASES) console.log(`  ${item.id}  ${item.prompt}`);
    console.log(`\n基线参数：${JSON.stringify(EXPERIMENT_BASELINE)}\n`);
    return 0;
  }

  const env = readComfyUIEnv(process.env);
  const baseUrl = (argOf("url") ?? env.baseUrl).replace(/\/+$/, "");

  /* 批量维度：cases × seeds（各留单值兼容用法） */
  const singleCase = argOf("case");
  const caseIds = listArg("cases").length ? listArg("cases") : singleCase ? [singleCase] : [];
  const seeds = listArg("seeds").length
    ? listArg("seeds").map(Number).filter(Number.isFinite)
    : [numArg("seed", EXPERIMENT_BASELINE.seed)];

  const presets = caseIds.map((id) => {
    const found = EXPERIMENT_CASES.find((c) => c.id === id);
    if (!found) throw new Error(`未知 case「${id}」——用 --list 看固定测试集`);
    return found;
  });
  const customPrompt = argOf("prompt");
  if (presets.length === 0 && !customPrompt) {
    console.log("✗ 需要 --case/--cases（预置）或 --prompt（自定义）。用 --list 看测试集。");
    return 1;
  }

  const expId = argOf("exp") ?? argOf("tag") ?? caseIds[0] ?? "adhoc";
  const params = {
    steps: numArg("steps", EXPERIMENT_BASELINE.steps),
    cfg: numArg("cfg", EXPERIMENT_BASELINE.cfg),
    sampler: argOf("sampler") ?? EXPERIMENT_BASELINE.sampler,
    scheduler: argOf("scheduler") ?? EXPERIMENT_BASELINE.scheduler,
    width: numArg("width", EXPERIMENT_BASELINE.width),
    height: numArg("height", EXPERIMENT_BASELINE.height),
  };

  /* checkpoint：显式 > 环境变量 > 实例允许列表第一个（取自真实实例，不是猜的） */
  let checkpoint = argOf("checkpoint") ?? env.checkpoint;
  if (!checkpoint) {
    const infoRes = await fetch(`${baseUrl}/object_info`).catch(() => null);
    if (!infoRes?.ok) {
      console.log(`✗ 连不上 ${baseUrl}/object_info，无法确定 checkpoint`);
      return 1;
    }
    const allowed = getAvailableCheckpoints((await infoRes.json()) as ComfyObjectInfo);
    if (allowed.length === 0) {
      console.log("✗ 实例没有任何 checkpoint");
      return 1;
    }
    checkpoint = allowed[0];
  }

  const imageDir = resolve(argOf("out") ?? ".rivet/experiments/images");
  const jsonlPath = resolve(argOf("jsonl") ?? ".rivet/experiments/results.jsonl");
  await mkdir(imageDir, { recursive: true });
  await mkdir(dirname(jsonlPath), { recursive: true });

  const provider = createComfyUIProviderFromEnv(process.env, { baseUrl, artifactDir: imageDir });

  /* 待跑清单（cases × seeds） */
  const jobs: { caseId: string | null; prompt: string; seed: number }[] = [];
  const plan = presets.length > 0 ? presets : [{ id: "(adhoc)", prompt: customPrompt! }];
  for (const item of plan) {
    for (const seed of seeds) {
      jobs.push({ caseId: presets.length > 0 ? item.id : null, prompt: item.prompt, seed });
    }
  }

  console.log(
    `\n实验 ${expId} —— ${jobs.length} 张  ` +
      `checkpoint=${checkpoint} steps=${params.steps} cfg=${params.cfg} ` +
      `${params.sampler}/${params.scheduler} ${params.width}×${params.height}`,
  );

  let ok = 0;
  const failures: string[] = [];
  for (const [index, job] of jobs.entries()) {
    const label = `${job.caseId ?? "(adhoc)"}/seed=${job.seed}`;
    const prefix = `exp-${expId}-${job.caseId ?? "adhoc"}-s${job.seed}`;
    process.stdout.write(`  [${index + 1}/${jobs.length}] ${label} … `);
    try {
      const result = await provider.generate({
        prompt: job.prompt,
        checkpoint,
        seed: job.seed,
        steps: params.steps,
        cfg: params.cfg,
        sampler: params.sampler,
        scheduler: params.scheduler,
        width: params.width,
        height: params.height,
        filenamePrefix: prefix,
      });
      const bytes = new Uint8Array(await readFile(result.artifactPath));
      const hash = sha256(bytes);
      console.log(`${bytes.length}B ${result.filename}`);
      await appendFile(
        jsonlPath,
        JSON.stringify({
          experimentId: expId,
          tag: expId,
          case: job.caseId,
          prompt: job.prompt,
          negativePrompt: result.negativePrompt ?? null,
          checkpoint,
          seed: result.seed,
          steps: result.steps,
          cfg: result.cfg,
          sampler: result.sampler,
          scheduler: result.scheduler,
          width: result.width,
          height: result.height,
          promptId: result.id,
          filename: result.filename,
          artifactPath: result.artifactPath,
          bytes: bytes.length,
          sha256: hash,
          mimeType: result.mimeType,
          provider: result.provider,
          ts: new Date().toISOString(),
        }) + "\n",
      );
      ok += 1;
    } catch (error) {
      const detail = error instanceof ImageGenError ? `${error.code}：${error.message}` : String(error);
      console.log(`✗ ${detail}`);
      failures.push(`${label} → ${detail}`);
    }
  }

  console.log(`\n完成：成功 ${ok}/${jobs.length}${failures.length ? `，失败 ${failures.length}` : ""}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`jsonl: ${jsonlPath}`);
  return failures.length === 0 ? 0 : 1;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`实验脚本自身出错：${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 2;
  });
