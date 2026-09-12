import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PRD_TEXT = `## 用户故事
- As a 新用户, I want 完成引导, so that 看到价值。
  - [ ] Given 首次登录 When 进入首页 Then 显示引导`;

describe("POST /api/export（Wave 5.5）", () => {
  it("默认导出整份报告 Markdown", async () => {
    const res = await POST(
      makeRequest({
        name: "Notion",
        sections: [{ agentId: "market", output: "市场分析正文" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    const md = await res.text();
    expect(md).toContain("# Notion · 拆解报告");
    expect(md).toContain("市场分析正文");
  });

  it("format=issues 把 PRD 用户故事转成 issue Markdown", async () => {
    const res = await POST(
      makeRequest({
        format: "issues",
        sections: [{ agentId: "prd", output: PRD_TEXT }],
      }),
    );
    expect(res.status).toBe(200);
    const md = await res.text();
    expect(md).toContain("用户故事");
    expect(md).toContain("验收标准");
    expect(md).toContain("As a **新用户**");
  });

  it("format=issues-json 返回合法 JSON", async () => {
    const res = await POST(
      makeRequest({
        format: "issues-json",
        sections: [{ agentId: "prd", output: PRD_TEXT }],
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { issues: unknown[] };
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.issues).toHaveLength(1);
  });

  it("缺少 sections 时不崩溃（导出空报告骨架）", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("拆解报告");
  });

  it("请求体非 JSON → 400", async () => {
    const req = new NextRequest("http://localhost/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{不是 json",
    });
    expect((await POST(req)).status).toBe(400);
  });

  it("证据标签随导出透传到 Markdown（补该 HTTP 层覆盖）", async () => {
    const res = await POST(
      makeRequest({
        name: "Notion",
        sections: [
          {
            agentId: "market",
            output: "市场分析正文",
            evidence: [
              {
                claim: "官网地址",
                label: "verified",
                source: "https://notion.so",
              },
            ],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const md = await res.text();
    expect(md).toContain("[已核实] 官网地址");
    expect(md).toContain("https://notion.so");
  });
});
