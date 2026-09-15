import type { LLMProvider } from "@/lib/llm/provider";
import { parseImageDataUrl } from "@/lib/parsers/image";
import { extractMermaidBlocks } from "./mermaid-blocks";
import { buildDiagramVisionMessages, buildStubDiagram } from "./vision-prompt";

/**
 * 多模态架构图提取引擎（W25）。
 *
 * 输入一张架构图截图（base64 + MIME），输出可直接渲染的 mermaid 代码与结构化元信息
 * （图形类型 / 置信度 / 节点数）。真实模型走 OpenAI 兼容的多模态 messages；
 * **未配置 Key 时自动回退到确定性 Stub**，全部异常路径降级为安全默认结构并标记 error ——
 * 与 W22/W23 一脉相承：解析层永不抛错。
 */

export interface DiagramVisionRequest {
  /** 纯 base64，或已带 `data:` 前缀的 data URL */
  imageBase64: string;
  mimeType: string;
  /** 可选提示（如 "flowchart" / "state"），用于引导模型与 Stub */
  diagramTypeHint?: string;
}

export type VisionSource = "model" | "stub" | "fallback";

export interface VisionDiagramResult {
  /** 清洗后的 mermaid 代码 */
  code: string;
  /** 图形类型（flowchart / stateDiagram-v2 / …；识别不出为 "unknown"） */
  diagramType: string;
  /** 置信度 0-100（降级路径为 0） */
  confidenceScore: number;
  /** 识别到的节点数 */
  detectedNodesCount: number;
  /** 结果来源：模型直出 / Stub 兜底 / 失败降级 */
  source: VisionSource;
  /** 降级原因（仅 fallback 时给出） */
  error?: string;
}

export interface VisionParserOptions {
  /** 注入 provider（测试 / 自定义端点）；缺省从环境变量构造 */
  provider?: LLMProvider;
  /** 强制 Stub（本地测试 / 演示） */
  stub?: boolean;
  signal?: AbortSignal;
}

/** 无法识别时的安全默认结构：一个合法但无节点的 flowchart */
export const FALLBACK_DIAGRAM_CODE = "flowchart TD\n  %% 未能从图像识别出架构图";

/* ── 代码清洗 ── */

/** 图形关键字（首行声明） */
const DIAGRAM_KEYWORDS = [
  "flowchart",
  "graph",
  "stateDiagram-v2",
  "stateDiagram",
  "sequenceDiagram",
  "classDiagram",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "gitGraph",
  "C4Context",
  "quadrantChart",
  "timeline",
];

/** 结构行（不参与节点/边的解析）：图形声明、子图、样式、注释等 */
const STRUCTURAL =
  /^(flowchart|graph|stateDiagram(-v2)?|sequenceDiagram|classDiagram|erDiagram|journey|gantt|pie|mindmap|gitGraph|C4Context|quadrantChart|timeline|subgraph|end|direction|classDef|class|style|linkStyle|click|note|accTitle|accDescr)\b/i;

function isStructuralLine(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (text.startsWith("%%")) return true;
  return STRUCTURAL.test(text);
}

/** mermaid 边类型（单一事实来源：切分与计数共用） */
const EDGE_SOURCE =
  "(<-->|-\\.->|-\\.-|==>|===|-->|---|--x|--o|->>|~~>|\\.\\.>|o--o|x--x|~~~)";

/** 形状开括号（节点定义的起点） */
const SHAPE_OPEN = /(\[\(|\[\[|\(\[|\{\{|\[\/|\[\\|\[|\(|\{)/;

/** 合法 id：以字母/下划线/汉字开头，后续为字母数字下划线连字符 */
const VALID_ID = /^[\p{L}_][\p{L}\p{N}_-]*$/u;

/** 清洗单个节点 id：非法字符 → 下划线；数字开头 → 前缀 N */
export function sanitizeNodeId(id: string): string {
  const raw = (id ?? "").trim();
  if (!raw) return "N";
  if (VALID_ID.test(raw)) return raw;
  let cleaned = raw.replace(/[^\p{L}\p{N}_-]/gu, "_");
  cleaned = cleaned.replace(/_{2,}/g, "_").replace(/^_+/, "");
  if (!cleaned) return "N";
  if (!/^[\p{L}_]/u.test(cleaned)) cleaned = `N${cleaned}`;
  return cleaned;
}

function sanitizeChunkHead(chunk: string): string {
  const opener = SHAPE_OPEN.exec(chunk);
  if (opener && opener.index !== undefined && opener.index > 0) {
    // 形状开括号之前的一切都是 id（可能含空格，如 "Node 1[用户]"）
    const before = chunk.slice(0, opener.index);
    const m = /^(\s*)(\|[^|]*\|\s*)?([\s\S]*)$/.exec(before);
    if (!m) return chunk;
    const rawId = m[3];
    if (!rawId.trim()) return chunk;
    const cleaned = sanitizeNodeId(rawId);
    if (cleaned === rawId) return chunk;
    return m[1] + (m[2] ?? "") + cleaned + chunk.slice(opener.index);
  }
  // 无形状：只清洗首个空白分隔 token（裸引用的 id 不含空格）
  const m = /^(\s*)(\|[^|]*\|\s*)?([^\s\[\](){}<>|]+)/.exec(chunk);
  if (!m) return chunk;
  const id = m[3];
  const cleaned = sanitizeNodeId(id);
  if (cleaned === id) return chunk;
  return m[1] + (m[2] ?? "") + cleaned + chunk.slice(m[0].length);
}

function sanitizeContentLine(line: string): string {
  const parts = line.split(new RegExp(EDGE_SOURCE));
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    out += i % 2 === 1 ? parts[i] : sanitizeChunkHead(parts[i]);
  }
  return out;
}

/** 清洗 mermaid 代码里的非法节点 id（结构行原样保留） */
export function sanitizeMermaidNodeIds(code: string): string {
  if (typeof code !== "string" || !code) return "";
  return code
    .split(/\r?\n/)
    .map((line) => (isStructuralLine(line) ? line : sanitizeContentLine(line)))
    .join("\n");
}

/* ── 代码提取 ── */

/**
 * 剥离围栏行。
 * - 形如 ``` / ```mermaid 的纯分隔行直接丢弃；
 * - 形如 ```flowchart TD 的「信息串其实是图形声明」的畸形围栏，保留信息串正文
 *   （模型偶尔会把语言与声明写在同一行，整行丢掉会连图形关键字一起吞掉）。
 */
const FENCE_LINE = /^\s*```+\s*(.*)$/;
const FENCE_LANGS = new Set([
  "",
  "mermaid",
  "md",
  "markdown",
  "text",
  "txt",
  "plaintext",
  "json",
  "yaml",
  "yml",
  "html",
  "css",
  "js",
  "ts",
  "bash",
  "sh",
]);

function stripFenceLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = FENCE_LINE.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    if (FENCE_LANGS.has(match[1].trim().toLowerCase())) continue;
    out.push(match[1]);
  }
  return out.join("\n").trim();
}

/**
 * 从模型原始回复中取出 mermaid 代码：
 *   1. 优先取 ```mermaid 围栏内容（围栏外的解释文字丢弃）；
 *   2. 无 mermaid 关键字但有其它围栏时，剥掉围栏行、保留正文；
 *   3. 最后清洗非法节点 id。
 */
export function extractDiagramCode(raw: string): string {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (!text) return "";

  const blocks = extractMermaidBlocks(text);
  if (blocks.length > 0 && blocks[0].code.trim()) {
    return sanitizeMermaidNodeIds(blocks[0].code.trim());
  }

  return sanitizeMermaidNodeIds(stripFenceLines(text));
}

/* ── 结构分析 ── */

/** 由首行声明识别图形类型（跳过注释与空行）；识别不出返回 "unknown" */
export function detectDiagramType(code: string): string {
  if (typeof code !== "string") return "unknown";
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%")) continue;
    const first = line.split(/[\s{[]/)[0];
    const hit = DIAGRAM_KEYWORDS.find(
      (keyword) => keyword.toLowerCase() === first.toLowerCase(),
    );
    if (!hit) return "unknown";
    return hit === "graph" ? "flowchart" : hit;
  }
  return "unknown";
}

/** 一行的节点候选 token：剔除边标签、节点标签、子图声明与转移说明 */
function nodeTokens(line: string): string[] {
  const cleaned = line
    .replace(/\|[^|]*\|/g, " ") // 边标签 |HTTPS|
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ") // 节点标签/形状
    .replace(/\s*:.*$/, " "); // 状态转移说明 "A --> B: 说明"
  return [...cleaned.matchAll(/[\p{L}_][\p{L}\p{N}_-]*/gu)].map((m) => m[0]);
}

/** 统计去重后的节点数 */
export function countDiagramNodes(code: string): number {
  if (typeof code !== "string") return 0;
  const ids = new Set<string>();
  for (const line of code.split(/\r?\n/)) {
    if (isStructuralLine(line)) continue;
    for (const token of nodeTokens(line)) ids.add(token);
  }
  return ids.size;
}

/** 统计边数量 */
function countDiagramEdges(code: string): number {
  if (typeof code !== "string") return 0;
  const edge = new RegExp(EDGE_SOURCE, "g");
  let count = 0;
  for (const line of code.split(/\r?\n/)) {
    if (isStructuralLine(line)) continue;
    count += (line.match(edge) ?? []).length;
  }
  return count;
}

/**
 * 置信度启发式（0-100）：有图形声明 +25、节点数最多 +15、有连线 +10，基线 40。
 * 刻意不设 100 —— 从截图还原的结构不该自称满分。
 */
export function scoreDiagramConfidence(
  code: string,
  nodeCount: number,
  edgeCount: number,
): number {
  if (typeof code !== "string" || !code.trim()) return 0;
  let score = 40;
  if (detectDiagramType(code) !== "unknown") score += 25;
  score += Math.min(Math.max(nodeCount, 0), 5) * 3;
  if (edgeCount > 0) score += 10;
  return Math.max(0, Math.min(100, score));
}

/* ── 结果构造 ── */

function makeResult(
  code: string,
  source: VisionSource,
  error?: string,
): VisionDiagramResult {
  const trimmed = (code ?? "").trim();
  // 没有图形声明就不是图谱 —— 此时按「未提取到结构」计，绝不给散文虚高的节点数/置信度
  const isDiagram = detectDiagramType(trimmed) !== "unknown";
  const nodeCount = isDiagram ? countDiagramNodes(trimmed) : 0;
  const edgeCount = isDiagram ? countDiagramEdges(trimmed) : 0;
  const result: VisionDiagramResult = {
    code: trimmed,
    diagramType: detectDiagramType(trimmed),
    confidenceScore: isDiagram
      ? scoreDiagramConfidence(trimmed, nodeCount, edgeCount)
      : 0,
    detectedNodesCount: nodeCount,
    source,
  };
  if (error) result.error = error;
  return result;
}

function buildFallbackResult(error: string): VisionDiagramResult {
  return {
    code: FALLBACK_DIAGRAM_CODE,
    diagramType: "flowchart",
    confidenceScore: 0,
    detectedNodesCount: 0,
    source: "fallback",
    error,
  };
}

function buildImageDataUrl(request: DiagramVisionRequest): string {
  const raw = (request?.imageBase64 ?? "").trim();
  if (/^data:/i.test(raw)) return raw;
  const mime = (request?.mimeType ?? "").trim().toLowerCase();
  return mime ? `data:${mime};base64,${raw}` : raw;
}

async function resolveProvider(
  options: VisionParserOptions,
): Promise<LLMProvider | null> {
  if (options.provider) return options.provider;
  if (options.stub) return null;
  try {
    // 懒加载：避免把服务端配置（zod / env）拖进任何潜在的前端引用
    const { createProviderFromEnv } = await import("@/lib/config");
    return createProviderFromEnv();
  } catch {
    return null; // 未配置 Key → Stub 兜底
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "未知错误";
}

/** 折行压平并截断，用于把模型原话放进 error 便于排障 */
function snippet(text: string, max = 60): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * 从架构图截图提取 mermaid 代码。
 *
 * 三条路径：注入/环境 provider → 模型提取；未配置 Key → 确定性 Stub；
 * 任何异常（非图像输入 / 损坏数据 / API 失败 / 空产出）→ 安全默认结构 + error。
 * **绝不抛错。**
 */
export async function parseDiagramFromImage(
  request: DiagramVisionRequest,
  options: VisionParserOptions = {},
): Promise<VisionDiagramResult> {
  try {
    const validated = parseImageDataUrl(buildImageDataUrl(request));
    if (!validated.ok) {
      return buildFallbackResult(validated.error ?? "图片不合法");
    }

    const provider = await resolveProvider(options);
    if (!provider) {
      return makeResult(buildStubDiagram(request).code, "stub");
    }

    const response = await provider.chat(
      buildDiagramVisionMessages(request, validated.dataUrl),
      { signal: options.signal },
    );
    const rawContent = response?.content ?? "";
    const code = extractDiagramCode(rawContent);
    if (!code) {
      return buildFallbackResult("模型未返回可用的图表代码");
    }
    // 模型常以自然语言回话（「这张图看不清…」）；那不是一个可渲染的图谱。
    // 此时降级为安全默认结构，并把模型原话片段带进 error —— 绝不把散文当图谱返回。
    if (detectDiagramType(code) === "unknown") {
      return buildFallbackResult(
        `模型未返回可识别的 mermaid 结构（回复片段：${snippet(rawContent)}）`,
      );
    }
    return makeResult(code, "model");
  } catch (err) {
    return buildFallbackResult(messageOf(err));
  }
}
