/**
 * ComfyUI 真实 E2E（live）—— 需要**真实实例 + 真实 checkpoint + 真实 GPU**。
 *
 * 用法：
 *   npm run comfy:e2e                                   # 脚本自带 --live，开箱即用
 *   COMFYUI_LIVE_TEST=true npm run comfy:e2e            # 或显式开开关（CI 用）
 *
 * 未开启开关时打印 [SKIP] 并以 **exit 2** 结束 —— 绝不把「没跑」伪装成「通过」。
 *
 * 与 `comfy:txt2img` 的分工：本脚本是**验证**（逐步给出证据 + 交叉核对），
 * `comfy:txt2img` 是**生成**（人要一张图）。两者共用同一个 provider。
 *
 * 证据链（每一步都真的调一次真实 API）：
 *   ① GET /system_stats          实例与设备
 *   ② GET /object_info           真实 schema + 真实 checkpoint 允许值
 *   ③ build + validate           对着真实 object_info 逐节点校验
 *   ④ provider.generate          提交 → 执行 → history → view → 落盘
 *   ⑤ GET /history/<id>          独立通道交叉核对（不看 provider 自报）
 *   ⑥ 独立读盘                   字节数 / PNG 魔数 / 像素尺寸
 */
import { readFile } from "node:fs/promises";
import { buildTxt2ImgWorkflow } from "@/lib/canvas/comfy-bridge";
import {
  getAvailableCheckpoints,
  renderWorkflowReport,
  type ComfyObjectInfo,
} from "@/lib/canvas/comfy-doctor";
import {
  TXT2IMG_REQUIRED_NODES,
  createComfyUIProviderFromEnv,
} from "@/lib/image/comfyui-provider";
import { ImageGenError } from "@/lib/image/provider";
import { readComfyUIEnv } from "@/lib/config";

const argOf = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const LIVE = process.env.COMFYUI_LIVE_TEST === "true" || process.argv.includes("--live");

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const checks: string[] = [];
const pass = (label: string) => {
  checks.push(label);
  console.log(`[PASS] ${label}`);
};

/** 手解 PNG 尺寸（不引依赖）：IHDR 紧随 8 字节魔数，宽高在偏移 16/20 */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !PNG_MAGIC.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function main(): Promise<number> {
  if (!LIVE) {
    console.log(
      "\n[SKIP] live E2E 未开启。\n" +
        "       本脚本要求真实 ComfyUI 与真实 checkpoint，默认不跑。\n" +
        "       开启方式：npm run comfy:e2e（自带 --live）或 COMFYUI_LIVE_TEST=true\n",
    );
    return 2;
  }

  const env = readComfyUIEnv(process.env);
  const baseUrl = (argOf("url") ?? env.baseUrl).replace(/\/+$/, "");
  const prompt = argOf("prompt") ?? "一只坐在窗台上的猫，柔和光线，写实风格";

  console.log(`\nComfyUI 真实 E2E —— ${baseUrl}`);
  console.log("═".repeat(64));

  /* ① 实例可达 */
  const statsRes = await fetch(`${baseUrl}/system_stats`).catch(() => null);
  if (!statsRes?.ok) {
    console.log(`[FAIL] 连不上 ${baseUrl}/system_stats —— 真实 E2E 中止`);
    return 1;
  }
  const stats = (await statsRes.json()) as {
    system?: { comfyui_version?: string; pytorch_version?: string };
    devices?: { name?: string; type?: string }[];
  };
  console.log(
    `[1/6] /system_stats      ComfyUI ${stats.system?.comfyui_version ?? "?"} ` +
      `| ${stats.system?.pytorch_version ?? "?"} | ${stats.devices?.map((d) => d.name).join(", ") ?? "-"}`,
  );
  pass("Real /system_stats");

  /* ② 真实 schema */
  const infoRes = await fetch(`${baseUrl}/object_info`);
  if (!infoRes.ok) {
    console.log(`[FAIL] /object_info HTTP ${infoRes.status}`);
    return 1;
  }
  const objectInfo = (await infoRes.json()) as ComfyObjectInfo;
  const allowed = getAvailableCheckpoints(objectInfo);
  if (allowed.length === 0) {
    console.log("[FAIL] 本实例没有任何 checkpoint（真实 E2E 中止，不伪造）");
    return 1;
  }
  console.log(
    `[2/6] /object_info       ${Object.keys(objectInfo).length} 个节点类 | 可用 checkpoint: ${allowed.join(", ")}`,
  );
  pass("Real /object_info");

  /* checkpoint：显式指定 > 环境变量 > 实例允许列表第一个（取自真实实例，不是猜的） */
  const checkpoint = argOf("checkpoint") ?? env.checkpoint ?? allowed[0];
  if (!allowed.includes(checkpoint)) {
    console.log(`[FAIL] checkpoint「${checkpoint}」不在实例允许列表：${allowed.join(", ")}`);
    return 1;
  }
  console.log(`[3/6] real checkpoint    ${checkpoint}`);
  pass("Real checkpoint");

  /* ③ 对真实 schema 逐节点校验（只读展示；真正的闸门在 provider 内部，同一批函数） */
  const width = Number(argOf("width") ?? 512);
  const height = Number(argOf("height") ?? 512);
  const steps = Number(argOf("steps") ?? 20);
  const report = renderWorkflowReport(
    buildTxt2ImgWorkflow({ prompt, checkpoint, width, height, steps }),
    objectInfo,
    { requireNodes: [...TXT2IMG_REQUIRED_NODES] },
  );
  console.log(`[4/6] workflow validation`);
  for (const line of report.text.split("\n")) console.log(`        ${line}`);
  if (report.verdict === "blocked") {
    console.log("\n[FAIL] workflow 校验未通过，未提交 /prompt");
    return 1;
  }
  pass("Workflow validation");

  /* ④ 走 provider 的完整链路 */
  const provider = createComfyUIProviderFromEnv(process.env, { baseUrl });
  let result;
  try {
    result = await provider.generate({ prompt, checkpoint, width, height, steps });
  } catch (error) {
    if (error instanceof ImageGenError) {
      console.log(`\n[FAIL] ${error.code}：${error.message}`);
      console.log(`       details: ${JSON.stringify(error.details ?? null).slice(0, 600)}`);
    } else {
      console.log(`\n[FAIL] 未预期错误：${error instanceof Error ? error.stack : String(error)}`);
    }
    return 1;
  }
  console.log(`[5/6] provider.generate  prompt_id=${result.id}`);
  console.log(`        artifact=${result.artifactPath}`);
  pass("POST /prompt");
  pass("Real execution");

  /* ⑤ 独立通道交叉核对（不看 provider 自报） */
  const historyRes = await fetch(`${baseUrl}/history/${encodeURIComponent(result.id)}`);
  const historyBody = (await historyRes.json()) as Record<
    string,
    { status?: { status_str?: string }; outputs?: Record<string, unknown> }
  >;
  const record = historyBody[result.id];
  if (!record) {
    console.log("[FAIL] /history 里查不到本次 prompt_id（provider 自报与真实不一致）");
    return 1;
  }
  const statusStr = record.status?.status_str ?? "(无)";
  const outputNodes = Object.keys(record.outputs ?? {});
  console.log(`[6/6] /history 交叉核对 status=${statusStr} outputs=[${outputNodes.join(", ")}]`);
  if (statusStr !== "success") {
    console.log("[FAIL] 执行状态不是 success");
    return 1;
  }
  pass("History output");

  /* ⑥ 独立读盘 */
  const bytes = new Uint8Array(await readFile(result.artifactPath));
  const size = pngSize(bytes);
  const isPng = size !== null;
  console.log(
    `        /view URL  : ${result.url}\n` +
      `        bytes      : ${bytes.length}（provider 报 ${result.bytes}）\n` +
      `        magic      : ${isPng ? "PNG ✓" : "非 PNG ✗"}\n` +
      `        dimensions : ${size ? `${size.width}×${size.height}` : "?"}`,
  );
  if (!isPng || bytes.length === 0) {
    console.log("[FAIL] 落盘文件不是有效 PNG");
    return 1;
  }
  if (bytes.length !== result.bytes) {
    console.log("[FAIL] 落盘字节数与 provider 上报不一致");
    return 1;
  }
  pass("/view");
  pass("Real image magic-byte validation");

  console.log("\n" + "─".repeat(64));
  for (const check of checks) console.log(`[PASS] ${check}`);
  console.log("\nREAL E2E PASS\n");
  return 0;
}

/**
 * 用 `process.exitCode` 而非 `process.exit()`：后者在 Windows 上会因未关闭句柄
 * 触发 libuv 断言把退出码冲成 127（见 scripts\comfy-doctor.ts 的同款说明）。
 */
void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`E2E 脚本自身出错：${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 2;
  });
