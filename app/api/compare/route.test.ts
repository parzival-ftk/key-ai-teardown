import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/compare 输入校验（W11）", () => {
  it("少于 2 个产品 → 400 + zod issues", async () => {
    const res = await POST(makeRequest({ products: [{ name: "A" }] }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string; issues?: unknown[] };
    expect(data.error).toBe("输入校验失败");
    expect(Array.isArray(data.issues)).toBe(true);
  });

  it("多于 3 个产品 → 400", async () => {
    const res = await POST(
      makeRequest({
        products: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("请求体非 JSON → 400", async () => {
    const req = new NextRequest("http://localhost/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{不是 json",
    });
    expect((await POST(req)).status).toBe(400);
  });

  it("合法 2 产品但缺少 LLM 配置 → 400（走到配置检查）", async () => {
    const keys = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"] as const;
    const saved = keys.map((k) => [k, process.env[k]] as const);
    for (const k of keys) delete process.env[k];
    try {
      const res = await POST(
        makeRequest({ products: [{ name: "A" }, { name: "B" }] }),
      );
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("LLM");
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
