import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { renderUiStructure } from "@/lib/parsers/dom";

// W8：url 分支会尝试无头渲染——测试里 mock 掉，避免真启浏览器 / 真联网。
vi.mock("@/lib/parsers/dom", () => ({
  renderUiStructure: vi.fn(),
  summarizeUiStructure: vi.fn(() => "UI 结构摘要（mock）"),
}));
const mockedRender = vi.mocked(renderUiStructure);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(bodyText: string): NextRequest {
  return new NextRequest("http://localhost/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
}

/** 构造一个最小可解析 PDF 并返回其 base64（与 pdf.test.ts 的 fixture 同源） */
function buildMinimalPdfBase64(text: string): string {
  const objs: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  };
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let body = "%PDF-1.4\n";
  const offsets: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = body.length;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body + xref + trailer, "latin1").toString("base64");
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/parse（Wave 4.4）", () => {
  it("text 直通", async () => {
    const res = await POST(makeRequest({ type: "text", text: "  一段描述  " }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { text: string; ok: boolean };
    expect(data.text).toBe("一段描述");
    expect(data.ok).toBe(true);
  });

  it("url 缺字段 → 400", async () => {
    const res = await POST(makeRequest({ type: "url" }));
    expect(res.status).toBe(400);
  });

  it("url 非法 → 422（不发起网络请求）", async () => {
    mockedRender.mockRejectedValue(new Error("headless unavailable"));
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const res = await POST(makeRequest({ type: "url", url: "不是网址" }));
    expect(res.status).toBe(422);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("url 成功（stub fetch）+ headless 不可用 → 200 + 正文，无 uiStructure", async () => {
    mockedRender.mockRejectedValue(new Error("no chrome"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><title>示例</title></head><body><article>正文内容在此</article></body></html>",
            { status: 200 },
          ),
      ),
    );
    const res = await POST(
      makeRequest({ type: "url", url: "https://example.com" }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      text: string;
      title: string;
      uiStructure?: string;
    };
    expect(data.title).toBe("示例");
    expect(data.text).toContain("正文内容在此");
    expect(data.uiStructure).toBeUndefined();
  });

  it("url 成功且 headless 可用 → 200 + 附带 uiStructure", async () => {
    mockedRender.mockResolvedValue({
      url: "https://example.com",
      title: "示例",
      totalElements: 1,
      elements: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><title>示例</title></head><body><article>正文</article></body></html>",
            { status: 200 },
          ),
      ),
    );
    const res = await POST(
      makeRequest({ type: "url", url: "https://example.com" }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { uiStructure?: string };
    expect(data.uiStructure).toBe("UI 结构摘要（mock）");
  });

  it("文本抓取失败但 headless 成功 → 仍 200（结构救活纯 JS 渲染页）", async () => {
    mockedRender.mockResolvedValue({
      url: "https://spa.example.com",
      title: "SPA",
      totalElements: 2,
      elements: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body></body></html>", { status: 200 })),
    );
    const res = await POST(
      makeRequest({ type: "url", url: "https://spa.example.com" }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      text: string;
      uiStructure?: string;
    };
    expect(data.ok).toBe(true);
    expect(data.text).toBe("");
    expect(data.uiStructure).toBe("UI 结构摘要（mock）");
  });

  it("pdf 合法 base64 → 200 + 提取文本", async () => {
    const res = await POST(
      makeRequest({
        type: "pdf",
        dataBase64: buildMinimalPdfBase64("Hello Parse Route"),
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { text: string; pages: number };
    expect(data.text).toContain("Hello Parse Route");
    expect(data.pages).toBe(1);
  });

  it("pdf 缺 dataBase64 → 400", async () => {
    const res = await POST(makeRequest({ type: "pdf" }));
    expect(res.status).toBe(400);
  });

  it("pdf 非法 base64 → 400", async () => {
    const res = await POST(
      makeRequest({ type: "pdf", dataBase64: "!!!这不是base64!!!" }),
    );
    expect(res.status).toBe(400);
  });

  it("screenshot 合法 data URL → 200", async () => {
    const res = await POST(
      makeRequest({ type: "screenshot", dataUrl: PNG_1X1 }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; mimeType: string };
    expect(data.ok).toBe(true);
    expect(data.mimeType).toBe("image/png");
  });

  it("screenshot 非法 → 422", async () => {
    const res = await POST(
      makeRequest({ type: "screenshot", dataUrl: "data:text/plain;base64,aGk=" }),
    );
    expect(res.status).toBe(422);
  });

  it("未知 type → 400", async () => {
    const res = await POST(makeRequest({ type: "unknown" }));
    expect(res.status).toBe(400);
  });

  it("请求体非 JSON → 400", async () => {
    const res = await POST(rawRequest("{不是 json"));
    expect(res.status).toBe(400);
  });
});
