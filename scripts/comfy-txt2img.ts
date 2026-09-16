/**
 * ComfyUI 最小文生图 API 闭环 —— 一条命令走完六个阶段。
 *
 *   GET /system_stats        →  ① 实例可达
 *   GET /object_info         →  ② 拉真实节点定义
 *   构造 buildTxt2ImgWorkflow →  ③ 最小 workflow
 *   renderWorkflowReport     →  ④ 机械校验（class_type / 输入名 / required / 类型 / enum / 连线）
 *   POST /prompt             →  ⑤ 提交并进入队列
 *   GET /history/<prompt_id> →  ⑥ 轮询执行结果
 *   GET /view?filename=…     →  ⑦ 取回图片字节，确认真的存在
 *
 * 用法：
 *   npm run comfy:txt2img                                   # 默认 http://127.0.0.1:8188
 *   npm run comfy:txt2img -- --url=http://127.0.0.1:8288
 *   npm run comfy:txt2img -- --prompt="一只坐在窗台上的猫" --width=512 --height=512
 *   npm run comfy:txt2img -- --scheduler=xxx                # 演示：非法枚举被校验拦下，exit 1
 *   npm run comfy:txt2img -- --dump                         # 额外打印将发送的 workflow JSON
 *
 * 退出码：闭环全通过 → 0；任一步失败（含校验 fail）→ 非 0。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_CHECKPOINT,
  buildTxt2ImgWorkflow,
  type Txt2ImgWorkflowInput,
  type ComfyWorkflow,
} from "@/lib/canvas/comfy-bridge";
import { renderWorkflowReport, type ComfyObjectInfo } from "@/lib/canvas/comfy-doctor";

/* ── 参数 ── */

const argOf = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};
const numArg = (name: string, fallback: number): number => {
  const raw = argOf(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const BASE_URL = (argOf("url") ?? process.env.COMFY_URL ?? "http://127.0.0.1:8188").replace(
  /\/+$/,
  "",
);
const OUT_DIR = resolve(argOf("out") ?? ".rivet/artifacts/comfy");

const POLL_MS = 400;
const HISTORY_TIMEOUT_MS = Number(process.env.COMFY_TIMEOUT_MS ?? 120_000);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (buf: Uint8Array) => PNG_MAGIC.every((byte, i) => buf[i] === byte);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── HTTP 小工具 ── */

interface JsonResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function fetchJson(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<JsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* 非 JSON：保持文本 */
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/* ── 主流程 ── */

async function main(): Promise<number> {
  const clientId = `comfy-txt2img-${Math.random().toString(36).slice(2, 10)}`;
  console.log(`\nComfyUI 最小文生图闭环 —— ${BASE_URL}`);
  console.log("─".repeat(64));

  /* ① 实例可达 */
  const stats = await fetchJson("/system_stats").catch((error: unknown) => ({
    ok: false,
    status: 0,
    body: error instanceof Error ? error.message : String(error),
  }));
  if (!stats.ok) {
    console.log(`[1/6] 实例探测        ✗ 连不上：${String(stats.body).slice(0, 140)}`);
    console.log(
      "      先启动实例：python main.py --enable-cors-header\n" +
        "      或本仓假实例：npm run stub:comfy（只回占位图，用于打通链路）",
    );
    return 1;
  }
  const sys = (stats.body as { system?: { comfyui_version?: string } }).system;
  const devices =
    (stats.body as { devices?: { name?: string }[] }).devices?.map((d) => d.name).join(", ") ?? "-";
  console.log(`[1/6] 实例探测        ✓ ${sys?.comfyui_version ?? "未知版本"}（devices: ${devices}）`);

  /* ② 节点自省 */
  const info = await fetchJson("/object_info");
  if (!info.ok || typeof info.body !== "object" || info.body === null) {
    console.log(`[2/6] 节点自省        ✗ /object_info 拉取失败（HTTP ${info.status}）`);
    return 1;
  }
  const objectInfo = info.body as ComfyObjectInfo;
  console.log(`[2/6] 节点自省        ✓ ${Object.keys(objectInfo).length} 个节点类`);

  /* ③ 构造 workflow */
  const input: Txt2ImgWorkflowInput = {
    prompt: argOf("prompt") ?? "一只坐在窗台上的猫，柔和光线，写实风格",
    width: numArg("width", 512),
    height: numArg("height", 512),
    steps: numArg("steps", 20),
    cfg: numArg("cfg", 7.5),
    seed: numArg("seed", 0),
    checkpoint: argOf("checkpoint") ?? DEFAULT_CHECKPOINT,
    ...(argOf("sampler") ? { samplerName: argOf("sampler") } : {}),
    ...(argOf("scheduler") ? { scheduler: argOf("scheduler") } : {}),
  };
  const workflow: ComfyWorkflow = buildTxt2ImgWorkflow(input);
  const classes = Object.values(workflow).map((node) => node.class_type);
  console.log(`[3/6] 构造 workflow   ✓ ${classes.length} 节点：${classes.join(" → ")}`);
  if (hasFlag("dump")) {
    console.log(`\n── 将发送的 workflow（API 格式）──\n${JSON.stringify(workflow, null, 2)}\n`);
  }

  /* ④ 机械校验 */
  const report = renderWorkflowReport(workflow, objectInfo, {
    requireNodes: [
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage",
    ],
  });
  console.log(`[4/6] workflow 校验`);
  for (const line of report.text.split("\n")) console.log(`       ${line}`);
  if (report.verdict === "blocked") {
    const available = getAvailableCheckpointsSafe(objectInfo);
    console.log(
      `\nFAIL —— workflow 校验未通过。本机可用 checkpoint：${
        available.length ? available.join(" / ") : "（无）"
      }`,
    );
    return 1;
  }

  /* ⑤ 提交 /prompt */
  const submit = await fetchJson("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!submit.ok) {
    console.log(`[5/6] 提交 /prompt     ✗ HTTP ${submit.status}`);
    console.log(`       ${JSON.stringify(submit.body).slice(0, 400)}`);
    return 1;
  }
  const promptId = (submit.body as { prompt_id?: string }).prompt_id ?? "";
  const queueNumber = (submit.body as { number?: number }).number;
  if (!promptId) {
    console.log(`[5/6] 提交 /prompt     ✗ 后端未返回 prompt_id`);
    return 1;
  }
  console.log(`[5/6] 提交 /prompt     ✓ prompt_id=${promptId}（队列号 ${queueNumber ?? "-"}）`);

  /* ⑥ 轮询 history */
  const deadline = Date.now() + HISTORY_TIMEOUT_MS;
  let record: HistoryEntry | null = null;
  while (Date.now() < deadline) {
    const history = await fetchJson(`/history/${encodeURIComponent(promptId)}`);
    const entry = (history.body as Record<string, HistoryEntry> | undefined)?.[promptId];
    if (entry) {
      record = entry;
      break;
    }
    await sleep(POLL_MS);
  }
  if (!record) {
    console.log(`[6/6] 结果确认        ✗ 超时（${HISTORY_TIMEOUT_MS}ms）未在 /history 看到结果`);
    return 1;
  }

  const image = firstImage(record.outputs);
  if (!image) {
    console.log(`[6/6] 结果确认        ✗ 执行完成但没有任何输出图片`);
    console.log(`       status: ${JSON.stringify(record.status ?? {})}`);
    return 1;
  }

  const viewUrl = `${BASE_URL}/view?${new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  }).toString()}`;
  const viewRes = await fetch(viewUrl);
  if (!viewRes.ok) {
    console.log(`[6/6] 结果确认        ✗ /view 返回 HTTP ${viewRes.status}`);
    return 1;
  }
  const bytes = new Uint8Array(await viewRes.arrayBuffer());
  if (bytes.length === 0 || !isPng(bytes)) {
    console.log(`[6/6] 结果确认        ✗ 取回的字节不是有效 PNG（${bytes.length} bytes）`);
    return 1;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const savedPath = join(OUT_DIR, image.filename);
  await writeFile(savedPath, bytes);

  console.log(
    `[6/6] 结果确认        ✓ ${image.filename}  ${bytes.length} bytes  PNG ✓  节点 ${image.nodeId}`,
  );
  console.log(`       /view: ${viewUrl}`);
  console.log(`       已保存: ${savedPath}`);

  console.log(`\nPASS —— 最小文生图闭环全程通过（实例：${sys?.comfyui_version ?? "未知"}）\n`);
  return 0;
}

/* ── 辅助 ── */

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>;
  status?: unknown;
}

interface PickedImage {
  nodeId: string;
  filename: string;
  subfolder?: string;
  type?: string;
}

function firstImage(outputs: HistoryEntry["outputs"]): PickedImage | null {
  for (const [nodeId, output] of Object.entries(outputs ?? {})) {
    const images = output?.images;
    if (Array.isArray(images) && images.length > 0) {
      return { nodeId, ...images[0] };
    }
  }
  return null;
}

function getAvailableCheckpointsSafe(objectInfo: ComfyObjectInfo): string[] {
  // 复用 doctor 的实现（此处内联以避免额外导入路径的耦合）
  const spec = objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  if (Array.isArray(spec) && Array.isArray(spec[0])) return (spec[0] as unknown[]).map(String);
  return [];
}

/**
 * 用 `process.exitCode` 而非 `process.exit()`：后者在有未关闭句柄时会让 Windows 的
 * libuv 断言把退出码冲成 127（见 scripts/comfy-doctor.ts 的同款说明）。
 */
void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`脚本自身出错：${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 2;
  });
