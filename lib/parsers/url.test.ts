import { describe, it, expect, vi } from "vitest";
import { parseUrl, extractFromHtml, normalizeUrl } from "./url";

const FIXTURE_HTML = `<!doctype html>
<html>
<head><title>示例产品官网</title><style>.x{color:red}</style></head>
<body>
<nav>导航菜单</nav>
<article>
  <h1>示例产品</h1>
  <p>这是一款  用于  测试的   产品。</p>
  <p>它的核心功能是抓取网页并提取正文。</p>
</article>
<script>console.log("noise")</script>
<footer>版权信息</footer>
</body>
</html>`;

function asFetch(fn: unknown): typeof fetch {
  return fn as typeof fetch;
}

describe("URL 解析器（Wave 4.1）", () => {
  it("normalizeUrl 拒绝非法 URL 与非 http(s) 协议", () => {
    expect(normalizeUrl("不是网址")).toBeNull();
    expect(normalizeUrl("ftp://x.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("https://example.com")?.hostname).toBe("example.com");
  });

  it("extractFromHtml 提取标题与正文，剔除 script/style/nav/footer", () => {
    const r = extractFromHtml(FIXTURE_HTML, "https://example.com");

    expect(r.title).toBe("示例产品官网");
    expect(r.text).toContain("这是一款 用于 测试的 产品。");
    expect(r.text).toContain("核心功能是抓取网页");
    expect(r.text).not.toContain("导航菜单");
    expect(r.text).not.toContain("版权信息");
    expect(r.text).not.toContain("console.log");
    expect(r.ok).toBe(true);
  });

  it("maxChars 截断正文", () => {
    const r = extractFromHtml(FIXTURE_HTML, "https://example.com", 10);
    expect(r.text.length).toBeLessThanOrEqual(10);
  });

  it("正文为空（JS 渲染的 SPA）时 ok:false 并给出可操作提示", () => {
    const spaHtml =
      '<html><head><title>App</title></head><body><div id="root"></div><script>render()</script></body></html>';
    const r = extractFromHtml(spaHtml, "https://app.example.com");

    expect(r.ok).toBe(false);
    expect(r.error).toContain("截图");
  });

  it("parseUrl 抓取成功返回标题与正文", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(FIXTURE_HTML, { status: 200 }),
    );
    const r = await parseUrl("https://example.com", {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(r.ok).toBe(true);
    expect(r.title).toBe("示例产品官网");
    expect(r.url).toBe("https://example.com/");
  });

  it("HTTP 非 2xx 返回 ok:false 与错误（不抛错）", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const r = await parseUrl("https://example.com", {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("403");
  });

  it("非法 URL 不发起请求", async () => {
    const fetchImpl = vi.fn();
    const r = await parseUrl("不是网址", { fetchImpl: asFetch(fetchImpl) });

    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("网络异常返回 ok:false（不抛错）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await parseUrl("https://example.com", {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
  });
});
