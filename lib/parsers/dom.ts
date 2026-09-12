import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeUrl } from "./url";

/**
 * DOM 结构抽取器（W8）—— 用**系统已安装的 Chrome/Edge** 无头渲染 URL，
 * 通过 CDP（Chrome DevTools Protocol）取回渲染后的 DOM + computed styles，
 * 产出可喂给「视觉设计 / 界面代码」Agent 的 UI 结构描述。
 *
 * 设计取舍：
 * - **零新增依赖**：不引入 Playwright/Puppeteer（会附带下载浏览器）。改用系统浏览器 +
 *   Node 内置 `WebSocket`（Node ≥ 22）直连 CDP。
 * - **可用性优先于完整性**：拿不到浏览器、或渲染失败，一律抛 HeadlessUnavailableError，
 *   由调用方**降级**为纯文本抓取（项目一贯的「单点失败不阻塞」）。
 * - **部署边界**：本模块依赖本机有 Chrome/Edge。Vercel 等 serverless 环境无浏览器，
 *   会走降级路径；要在线启用需接 @sparticuz/chromium 或外部渲染服务（见 README）。
 */

export class HeadlessUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeadlessUnavailableError";
  }
}

export interface UiElement {
  tag: string;
  cls: string;
  text: string;
  color: string;
  background: string;
  fontSize: string;
  fontWeight: string;
  padding: string;
  borderRadius: string;
  display: string;
}

export interface UiStructure {
  url: string;
  title: string;
  /** 可见元素总数（未截断前） */
  totalElements: number;
  /** 截断后的关键元素样本 */
  elements: UiElement[];
}

/** 各平台常见的 Chrome/Edge 可执行文件位置 */
const CHROME_CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ],
};

/**
 * 定位可用的浏览器可执行文件：优先环境变量 CHROME_PATH，其次各平台常见路径。
 * 找不到返回 null（调用方据此降级）。
 */
export function findChromePath(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string | null {
  const explicit = env.CHROME_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of CHROME_CANDIDATES[platform] ?? []) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** 在页面里执行的抽取表达式（返回 JSON 字符串）—— visible 元素 + 关键 computed styles */
export function buildStructureExpression(maxElements: number): string {
  return `(() => {
    const els = [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().width > 0);
    const pick = (el) => {
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") || "").slice(0, 60),
        text: (el.textContent || "").trim().slice(0, 40),
        color: cs.color,
        background: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        display: cs.display,
      };
    };
    return JSON.stringify({
      title: document.title,
      total: els.length,
      elements: els.slice(0, ${maxElements}).map(pick),
    });
  })()`;
}

function isUiElement(value: unknown): value is UiElement {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.tag === "string" &&
    typeof e.color === "string" &&
    typeof e.fontSize === "string"
  );
}

/** 宽松解析页面返回的 JSON（缺字段容错）；形状不符返回 null */
export function parseStructureJson(raw: string, url: string): UiStructure | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  if (!Array.isArray(record.elements)) return null;

  const elements = record.elements.filter(isUiElement).map((e) => ({
    tag: e.tag,
    cls: e.cls ?? "",
    text: e.text ?? "",
    color: e.color,
    background: e.background ?? "",
    fontSize: e.fontSize,
    fontWeight: e.fontWeight ?? "",
    padding: e.padding ?? "",
    borderRadius: e.borderRadius ?? "",
    display: e.display ?? "",
  }));

  return {
    url,
    title: typeof record.title === "string" ? record.title : "",
    totalElements: typeof record.total === "number" ? record.total : elements.length,
    elements,
  };
}

/** 把结构压成给 LLM 的紧凑文本（受 maxChars 约束，避免撑爆提示词） */
export function summarizeUiStructure(
  structure: UiStructure,
  maxChars = 1600,
): string {
  const lines = [
    "[页面结构与样式（headless 渲染）]",
    `标题：${structure.title || "（无）"}`,
    `可见元素数：${structure.totalElements}`,
    "关键元素（标签 · 类名 · 文本 · 关键样式）：",
  ];
  for (const e of structure.elements) {
    const cls = e.cls ? `.${e.cls.split(/\s+/).slice(0, 2).join(".")}` : "";
    const text = e.text ? ` "${e.text}"` : "";
    lines.push(
      `- <${e.tag}${cls}>${text} | 文字 ${e.color} / ${e.fontSize} ${e.fontWeight} · 背景 ${e.background} · 内边距 ${e.padding} · 圆角 ${e.borderRadius} · 布局 ${e.display}`,
    );
  }
  return lines.join("\n").slice(0, maxChars);
}

export interface RenderUiOptions {
  chromePath?: string;
  /** 整体超时（毫秒），默认 20s */
  timeoutMs?: number;
  /** 抽取的元素上限，默认 40 */
  maxElements?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CdpClient {
  ready: Promise<void>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  hasEvent(method: string): boolean;
  close(): void;
}

function connectCdp(wsUrl: string): CdpClient {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const events: string[] = [];

  const ready = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")));
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      method?: string;
      result?: unknown;
      error?: unknown;
    };
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg.method);
    }
  });

  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    hasEvent: (method) => events.includes(method),
    close: () => ws.close(),
  };
}

/** 从 Chrome 的 stderr 里解析 DevTools 监听地址（用随机端口启动时靠它发现端口） */
export function parseDevToolsEndpoint(stderrLine: string): string | null {
  const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderrLine);
  return match ? match[1] : null;
}

/** 等待 cd 启动并回报浏览器级 WebSocket 端点 */
function waitForBrowserEndpoint(
  child: ChildProcess,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error("等待浏览器调试端口超时")),
      timeoutMs,
    );
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const endpoint = parseDevToolsEndpoint(buffer);
      if (endpoint) {
        clearTimeout(timer);
        child.stderr?.off("data", onData);
        resolve(endpoint);
      }
    };
    child.stderr?.on("data", onData);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("浏览器进程提前退出"));
    });
  });
}

/**
 * 无头渲染 URL 并抽取 UI 结构。任何失败（无浏览器 / 超时 / 协议错误）都抛错，
 * 由调用方降级。保证不泄漏浏览器进程与临时目录。
 */
export async function renderUiStructure(
  rawUrl: string,
  options: RenderUiOptions = {},
): Promise<UiStructure> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new HeadlessUnavailableError("URL 格式非法（仅支持 http/https）");

  const chromePath = options.chromePath ?? findChromePath();
  if (!chromePath) {
    throw new HeadlessUnavailableError(
      "未找到可用的 Chrome/Edge（可设环境变量 CHROME_PATH 指定）",
    );
  }

  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxElements = options.maxElements ?? 40;
  const profile = mkdtempSync(path.join(tmpdir(), "key-headless-"));

  // 用 holder 持有子进程 / CDP 连接：TS 对「仅在闭包内赋值的 let」会收窄为 null，
  // 导致 finally 里访问其方法被推断成 never。
  const handle: { child: ChildProcess | null; client: CdpClient | null } = {
    child: null,
    client: null,
  };

  const run = async (): Promise<UiStructure> => {
    const proc = spawn(
      chromePath,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--hide-scrollbars",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    handle.child = proc;

    const browserWs = await waitForBrowserEndpoint(proc, timeoutMs);
    const port = new URL(browserWs).port;

    const created = (await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" },
    ).then((r) => r.json())) as { webSocketDebuggerUrl?: string };
    if (!created.webSocketDebuggerUrl) {
      throw new Error("无法创建页面目标");
    }

    const cdp = connectCdp(created.webSocketDebuggerUrl);
    handle.client = cdp;
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: url.toString() });

    for (let i = 0; i < 100 && !cdp.hasEvent("Page.loadEventFired"); i++) {
      await sleep(Math.max(50, Math.floor(timeoutMs / 200)));
    }

    const evaluated = (await cdp.send("Runtime.evaluate", {
      expression: buildStructureExpression(maxElements),
      returnByValue: true,
    })) as { result?: { value?: string } };

    const structure = parseStructureJson(
      evaluated.result?.value ?? "",
      url.toString(),
    );
    if (!structure) throw new Error("无法解析页面结构");
    return structure;
  };

  try {
    return await Promise.race([
      run(),
      sleep(timeoutMs).then(() => {
        throw new Error(`渲染超时（>${timeoutMs}ms）`);
      }),
    ]);
  } finally {
    handle.client?.close();
    handle.child?.kill();
    await sleep(200);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结果 */
    }
  }
}
