/**
 * ComfyUI 校准 CLI —— 把「对着真实例对参数」变成一条命令。
 *
 * 用法：
 *   npm run comfy:doctor                 # 默认 http://127.0.0.1:8188
 *   npm run comfy:doctor -- --url=http://127.0.0.1:8288
 *   npm run comfy:doctor -- --dump       # 额外打印本仓将发送的 workflow JSON（供与 WebUI 导出对比）
 *
 * 它做四件事：
 *   1. 探测实例可达性与版本（/system_stats）
 *   2. 拉取节点自省（/object_info），逐节点、逐输入比对 `buildInpaintWorkflow` 的产出
 *   3. 用一张内置 PNG 试跑 POST /upload/image，校验响应形状
 *   4. 打印分级报告（fail 优先）与结论；有 fail 时 exit 1
 *
 * 这个脚本**不生成图**，也不改任何文件 —— 它只告诉你「哪些地方对不上、该改成什么」。
 */
import {
  buildInpaintWorkflow,
  type ComfyWorkflow,
} from "@/lib/canvas/comfy-bridge";
import {
  getAvailableCheckpoints,
  inspectComfyNodeGraph,
  inspectUploadResponse,
  rankFindings,
  summarizeFindings,
  type ComfyObjectInfo,
  type DoctorFinding,
} from "@/lib/canvas/comfy-doctor";

const argOf = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const BASE_URL = (
  argOf("url") ??
  process.env.COMFY_URL ??
  "http://127.0.0.1:8188"
).replace(/\/+$/, "");
const DUMP = process.argv.includes("--dump");

const MARK: Record<DoctorFinding["level"], string> = {
  fail: "✗",
  warn: "!",
  manual: "?",
  ok: "✓",
};

function line(finding: DoctorFinding): string {
  const head = `${MARK[finding.level]} [${finding.id}] ${finding.message}`;
  const details: string[] = [];
  if (finding.expected) details.push(`    期望: ${finding.expected}`);
  if (finding.actual) details.push(`    实际: ${finding.actual}`);
  if (finding.hint) details.push(`    建议: ${finding.hint}`);
  return [head, ...details].join("\n");
}

/** 一张内置的 1×1 PNG（只为触发上传路径，内容不重要） */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function fetchJson(path: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* 非 JSON 原样返回 */
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function probeUpload(): Promise<DoctorFinding> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const form = new FormData();
    form.append("image", new Blob([TINY_PNG], { type: "image/png" }), "comfy-doctor.png");
    form.append("overwrite", "true");
    const response = await fetch(`${BASE_URL}/upload/image`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        level: "fail",
        id: "upload:http",
        message: `上传接口返回 HTTP ${response.status}`,
        hint: "确认实例已开启跨域（python main.py --enable-cors-header）且地址是 <base>/upload/image",
      };
    }
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* 保持文本 */
    }
    return inspectUploadResponse(body);
  } catch (error) {
    return {
      level: "fail",
      id: "upload:http",
      message: `上传请求失败：${error instanceof Error ? error.message : String(error)}`,
      hint: "实例没起来、端口不对，或浏览器/Node 无法直连（跨域）",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<number> {
  console.log(`\nComfyUI 校准报告 —— ${BASE_URL}\n${"─".repeat(60)}`);

  const findings: DoctorFinding[] = [];

  /* 1) 可达性 */
  const stats = await fetchJson("/system_stats").catch((error: unknown) => ({
    ok: false,
    status: 0,
    body: error instanceof Error ? error.message : String(error),
  }));
  if (!stats.ok) {
    console.log(`✗ [probe] 连不上 ${BASE_URL}（${String(stats.body).slice(0, 120)}）`);
    console.log(
      "\n先做这两步：\n" +
        "  1. 启动 ComfyUI：python main.py --enable-cors-header\n" +
        "  2. 想先看链路而不装 ComfyUI：node e2e/stub-comfy-server.mjs （本仓自带，只回占位图）\n",
    );
    return 1;
  }
  const version = (stats.body as { system?: { comfyui_version?: string } })?.system
    ?.comfyui_version;
  console.log(`✓ [probe] 实例可达${version ? `（ComfyUI ${version}）` : ""}`);
  findings.push({ level: "ok", id: "probe", message: "实例可达" });

  /* 2) 节点图比对 */
  const info = await fetchJson("/object_info");
  if (!info.ok || typeof info.body !== "object" || info.body === null) {
    console.log(`✗ [object_info] 拿不到节点自省（HTTP ${info.status}）`);
    return 1;
  }
  const objectInfo = info.body as ComfyObjectInfo;

  const checkpoints = getAvailableCheckpoints(objectInfo);
  console.log(
    checkpoints.length > 0
      ? `✓ [checkpoints] 本机模型：${checkpoints.join(" / ")}`
      : "! [checkpoints] 没读到任何 checkpoint —— 先往 ComfyUI 的 models/checkpoints 放一个模型",
  );

  const workflow: ComfyWorkflow = buildInpaintWorkflow({
    prompt: "<doctor 探针>",
    imageName: "comfy-doctor.png",
    maskName: "comfy-doctor-mask.png",
    ...(process.env.COMFY_CHECKPOINT ? { checkpoint: process.env.COMFY_CHECKPOINT } : {}),
  });

  if (DUMP) {
    console.log(`\n── 本仓将发送的 workflow（API 格式）──\n${JSON.stringify(workflow, null, 2)}`);
  }

  findings.push(...inspectComfyNodeGraph(workflow, objectInfo));

  /* 3) 上传契约 */
  findings.push(await probeUpload());

  /* 4) 报告 */
  const summary = summarizeFindings(findings);
  console.log(`\n── 逐项结论（fail 优先）──`);
  for (const finding of rankFindings(findings)) {
    if (finding.level === "ok" && !process.env.COMFY_DOCTOR_VERBOSE) continue; // 默认只报问题
    console.log(line(finding));
  }

  console.log(
    `\n── 汇总 ──\n  ✓ ${summary.ok}  ok   ! ${summary.warn}  warn   ✗ ${summary.fail}  fail   ? ${summary.manual}  manual`,
  );

  if (summary.verdict === "blocked") {
    console.log(
      "\n结论：**对不上**。按上面的「建议」逐条改，再跑一次；全绿后即可在 /canvas 里点 ComfyUI Inpaint。\n",
    );
    return 1;
  }

  console.log(
    summary.verdict === "attention"
      ? "\n结论：**基本可用**，但有 warn（见上）。\n"
      : "\n结论：**全部对得上**。可以到 /canvas 选中图片节点试一次真实 Inpaint。\n",
  );
  return 0;
}

/**
 * 用 `process.exitCode` 而非 `process.exit()` 收尾：后者在 Windows 上会在有未关闭句柄时
 * 触发 Node 的 libuv 断言（`!(handle->flags & UV_HANDLE_CLOSING)`），把退出码冲成 127，
 * 让 CI/脚本读到假的「命令不存在」。
 */
void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`doctor 自身出错：${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 2;
  });
