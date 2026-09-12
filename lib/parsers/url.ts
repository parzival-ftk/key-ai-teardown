import * as cheerio from "cheerio";

/**
 * URL 解析器（Wave 4.1）—— 抓取网页并提取正文，产出可喂给分析的纯文本。
 *
 * 设计要点：
 * - 只接受 http/https；
 * - 带超时（默认 15s），失败不抛错而是返回 ok:false（由调用方降级到文本输入）；
 * - 先剔除 script/style/nav 等噪声，再按 article > main > body 的优先级取正文。
 */

export interface UrlParseResult {
  url: string;
  title: string;
  text: string;
  ok: boolean;
  error?: string;
}

export interface ParseUrlOptions {
  timeoutMs?: number;
  maxChars?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CHARS = 8000;

/** 只做格式与协议校验，便于在抓取前快速失败 */
export function normalizeUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 从 HTML 提取标题与正文（纯函数，便于用固定 fixture 测试） */
export function extractFromHtml(
  html: string,
  url: string,
  maxChars = DEFAULT_MAX_CHARS,
): UrlParseResult {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, nav, footer, header, aside, form").remove();

  const title = ($("title").first().text() || $("h1").first().text() || "").trim();

  const container = $("article").length
    ? $("article")
    : $("main").length
      ? $("main")
      : $("body");

  const text = normalizeWhitespace(container.text()).slice(0, maxChars);
  return {
    url,
    title,
    text,
    ok: text.length > 0,
    error:
      text.length > 0
        ? undefined
        : "页面正文为空（可能是 JavaScript 渲染的页面，建议改用截图输入）",
  };
}

export async function parseUrl(
  rawUrl: string,
  options: ParseUrlOptions = {},
): Promise<UrlParseResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return {
      url: rawUrl,
      title: "",
      text: "",
      ok: false,
      error: "URL 格式非法（仅支持 http/https）",
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KeyBot/0.1; +https://github.com/key-app)",
      },
    });
    if (!res.ok) {
      return {
        url: url.toString(),
        title: "",
        text: "",
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }
    const html = await res.text();
    return extractFromHtml(html, url.toString(), maxChars);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const detail = err instanceof Error ? err.message || err.name : String(err);
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? `（${err.cause.message}）`
        : "";
    return {
      url: url.toString(),
      title: "",
      text: "",
      ok: false,
      error: aborted
        ? `抓取超时（>${timeoutMs}ms）`
        : `抓取失败：${detail}${cause}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
