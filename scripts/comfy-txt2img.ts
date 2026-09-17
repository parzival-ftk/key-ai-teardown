/**
 * ComfyUI 文生图 CLI —— 生成一张图（给人用的入口）。
 *
 * 用法：
 *   npm run comfy:txt2img -- --checkpoint=v1-5-pruned-emaonly-fp16.safetensors
 *   npm run comfy:txt2img -- --prompt="一只猫" --width=512 --height=512 --steps=20
 *   npm run comfy:txt2img -- --url=http://127.0.0.1:8288 --out=D:/out
 *
 * 配置优先级：CLI 参数 > 环境变量（COMFYUI_BASE_URL / COMFYUI_CHECKPOINT / …）> 代码默认值。
 *
 * 分工（阶段 12 起）：
 *   生成 → 本脚本（走 `ComfyUIProvider`）
 *   验证 → `npm run comfy:e2e`（live E2E 证据链）
 *   workflow 对照 → `npm run comfy:doctor -- --dump`
 *
 * 退出码：成功 0；生成失败 1（按 ImageGenError.code 打印）；脚本自身出错 2。
 */
import { createComfyUIProviderFromEnv } from "@/lib/image/comfyui-provider";
import { ImageGenError, type GenerationRequest } from "@/lib/image/provider";
import { readComfyUIEnv } from "@/lib/config";

const argOf = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const numArg = (name: string, fallback: number): number => {
  const raw = argOf(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

async function main(): Promise<number> {
  const env = readComfyUIEnv(process.env);
  const baseUrl = (argOf("url") ?? env.baseUrl).replace(/\/+$/, "");
  const artifactDir = argOf("out") ?? env.artifactDir;

  const provider = createComfyUIProviderFromEnv(process.env, { baseUrl, artifactDir });

  const checkpoint = argOf("checkpoint");
  const sampler = argOf("sampler");
  const scheduler = argOf("scheduler");
  const request: GenerationRequest = {
    prompt: argOf("prompt") ?? "一只坐在窗台上的猫，柔和光线，写实风格",
    width: numArg("width", 512),
    height: numArg("height", 512),
    steps: numArg("steps", 20),
    cfg: numArg("cfg", 7.5),
    seed: numArg("seed", 0),
    ...(checkpoint ? { checkpoint } : {}),
    ...(sampler ? { sampler } : {}),
    ...(scheduler ? { scheduler } : {}),
  };

  console.log(`\nComfyUI 文生图 —— ${baseUrl}`);
  console.log("─".repeat(64));

  try {
    const result = await provider.generate(request);
    console.log(`prompt_id   : ${result.id}`);
    console.log(`checkpoint  : ${result.checkpoint}`);
    console.log(`size        : ${result.width}×${result.height}  steps=${result.steps} cfg=${result.cfg}`);
    console.log(`sampler     : ${result.sampler} / ${result.scheduler}  seed=${result.seed}`);
    console.log(`image       : ${result.filename}  ${result.bytes} bytes  ${result.mimeType}`);
    console.log(`artifact    : ${result.artifactPath}`);
    console.log(`url         : ${result.url}`);
    console.log("\nPASS —— 生成成功\n");
    return 0;
  } catch (error) {
    if (error instanceof ImageGenError) {
      console.log(`✗ ${error.code}：${error.message}`);
      const available = (error.details as { availableCheckpoints?: string[] } | undefined)
        ?.availableCheckpoints;
      if (available?.length) {
        console.log(`  本机可用 checkpoint：${available.join(" / ")}`);
        console.log("  用 --checkpoint=<上面的名字> 指定，或写进 .env 的 COMFYUI_CHECKPOINT");
      } else if (error.details !== undefined) {
        console.log(`  details: ${JSON.stringify(error.details).slice(0, 500)}`);
      }
      return 1;
    }
    throw error;
  }
}

/**
 * 用 `process.exitCode` 而非 `process.exit()`：后者在有未关闭句柄时会让 Windows 的
 * libuv 断言把退出码冲成 127（见 scripts\comfy-doctor.ts 的同款说明）。
 */
void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`脚本自身出错：${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 2;
  });
