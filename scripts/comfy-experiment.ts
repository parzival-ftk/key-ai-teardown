/**
 * ComfyUI 生成质量实验 CLI（阶段 13）。
 *
 * 职责单一：用**给定参数**真实生成一张图，并把可追溯的 metadata 追加到 JSONL。
 * 生成一律走 `ComfyUIProvider`（**不**自己请求 `/prompt`）；本文件只额外读一次
 * `/object_info` 用来选默认 checkpoint —— 那是只读自省，不是生成路径。
 *
 * 用法：
 *   npm run comfy:experiment -- --list
 *   npm run comfy:experiment -- --case=case-01 --tag=baseline
 *   npm run comfy:experiment -- --case=case-01 --tag=steps-30 --steps=30
 *   npm run comfy:experiment -- --prompt="自定义" --seed=123456 --cfg=10
 *
 * 单变量原则：调用方一次只改一个参数，其余走基线默认（`EXPERIMENT_BASELINE`）。
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

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function main(): Promise<number> {
  if (process.argv.includes("--list")) {
    console.log("\n固定测试集（阶段 13）：");
    for (const item of EXPERIMENT_CASES) console.log(`  ${item.id}  ${item.prompt}`);
    console.log(`\n基线参数：${JSON.stringify(EXPERIMENT_BASELINE)}\n`);
    return 0;
  }

  const env = readComfyUIEnv(process.env);
  const baseUrl = (argOf("url") ?? env.baseUrl).replace(/\/+$/, "");
  const caseId = argOf("case");
  const preset = caseId ? EXPERIMENT_CASES.find((c) => c.id === caseId) : undefined;
  if (caseId && !preset) {
    console.log(`✗ 未知 case「${caseId}」。用 --list 看固定测试集。`);
    return 1;
  }

  const prompt = argOf("prompt") ?? preset?.prompt ?? EXPERIMENT_CASES[0].prompt;
  const tag = argOf("tag") ?? caseId ?? "adhoc";

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
    console.log(`· checkpoint 未指定，取自实例允许列表：${checkpoint}`);
  }

  const params = {
    seed: numArg("seed", EXPERIMENT_BASELINE.seed),
    steps: numArg("steps", EXPERIMENT_BASELINE.steps),
    cfg: numArg("cfg", EXPERIMENT_BASELINE.cfg),
    sampler: argOf("sampler") ?? EXPERIMENT_BASELINE.sampler,
    scheduler: argOf("scheduler") ?? EXPERIMENT_BASELINE.scheduler,
    width: numArg("width", EXPERIMENT_BASELINE.width),
    height: numArg("height", EXPERIMENT_BASELINE.height),
  };

  const imageDir = resolve(argOf("out") ?? ".rivet/experiments/images");
  const jsonlPath = resolve(argOf("jsonl") ?? ".rivet/experiments/results.jsonl");

  const provider = createComfyUIProviderFromEnv(process.env, {
    baseUrl,
    artifactDir: imageDir,
  });

  console.log(
    `\n[${tag}] ${caseId ?? "(adhoc)"}  ` +
      `seed=${params.seed} steps=${params.steps} cfg=${params.cfg} ` +
      `${params.sampler}/${params.scheduler} ${params.width}×${params.height}`,
  );
  console.log(`  prompt: ${prompt}`);

  try {
    const result = await provider.generate({
      prompt,
      checkpoint,
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
      sampler: params.sampler,
      scheduler: params.scheduler,
      width: params.width,
      height: params.height,
      filenamePrefix: `exp-${tag}`,
    });

    const bytes = new Uint8Array(await readFile(result.artifactPath));
    const hash = sha256(bytes);
    console.log(`  artifact: ${result.artifactPath}`);
    console.log(`  bytes  : ${bytes.length}  sha256=${hash.slice(0, 16)}…  ${result.mimeType}`);

    await mkdir(dirname(jsonlPath), { recursive: true });
    await appendFile(
      jsonlPath,
      JSON.stringify({
        tag,
        case: caseId ?? null,
        prompt,
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
    console.log(`  jsonl  : ${jsonlPath}`);
    return 0;
  } catch (error) {
    if (error instanceof ImageGenError) {
      console.log(`  ✗ ${error.code}：${error.message}`);
      return 1;
    }
    throw error;
  }
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`实验脚本自身出错：${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 2;
  });
