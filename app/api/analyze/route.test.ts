import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analyze 输入校验", () => {
  it("非法 mode 时返回通用错误 + zod issues，而不是硬编码的「产品名称不能为空」（审查发现回归）", async () => {
    const res = await POST(makeRequest({ name: "X", mode: "不存在的模式" }));

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string; issues?: unknown[] };
    expect(data.error).toBe("输入校验失败");
    expect(data.error).not.toContain("产品名称不能为空");
    expect(Array.isArray(data.issues)).toBe(true);
  });

  it("空名称同样返回 400", async () => {
    const res = await POST(makeRequest({ name: "" }));
    expect(res.status).toBe(400);
  });

  it("请求体非 JSON 时返回 400", async () => {
    const req = new NextRequest("http://localhost/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{不是 json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
