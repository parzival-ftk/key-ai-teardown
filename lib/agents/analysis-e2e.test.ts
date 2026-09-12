import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import { createAnalysisStream } from "./analysis-stream";
import { deserializeAgentEvent, type AgentEvent } from "@/lib/types/events";
import { parseProductBrief } from "@/lib/types/brief";

/**
 * 端到端集成测试（设计规格 §9）——**唯一替身是 stub LLM server**。
 *
 * 走的是与 /api/analyze 相同的真实路径：
 *   真实 OpenAICompatibleProvider（真实 fetch + SSE 解析）
 *   → 真实全编队（7 个 Agent，真实框架提示词）
 *   → 真实编排（并行 4 + 串行 3）
 *   → 真实 SSE 序列化
 * 中间层一律不 mock；只有上游 LLM 是一个本地 HTTP stub。
 */

const REPLY = "端到端回复：该赛道竞争激烈。";

/** 真实 HTTP stub LLM server，模拟 OpenAI 兼容端点的流式逐字输出 */
function startStubServer(reply: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        let stream = false;
        try {
          stream = JSON.parse(raw).stream === true;
        } catch {
          stream = false;
        }

        if (!stream) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              model: "stub-model",
              choices: [{ message: { content: reply } }],
            }),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const parts = [...reply];
        let i = 0;
        const timer = setInterval(() => {
          if (i >= parts.length) {
            res.write("data: [DONE]\n\n");
            clearInterval(timer);
            res.end();
            return;
          }
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`,
          );
        }, 1);
        res.on("close", () => clearInterval(timer));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<{
  raw: string;
  events: AgentEvent[];
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  const events = raw
    .split("\n")
    .map((line) => deserializeAgentEvent(line))
    .filter((e): e is AgentEvent => e !== null);
  return { raw, events };
}

describe("端到端：真实 HTTP + 全编队（唯一替身是 stub LLM server）", () => {
  let server: Server;
  let baseURL: string;

  beforeAll(async () => {
    const started = await startStubServer(REPLY);
    server = started.server;
    baseURL = `http://127.0.0.1:${started.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("全编队经真实 HTTP 走完：7 个 Agent 逐个产出、SSE 格式正确、以 done 收尾、无 error", async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL,
      apiKey: "sk-stub",
      model: "stub-model",
    });

    const stream = createAnalysisStream(
      parseProductBrief({ name: "Notion", description: "协作文档工具" }),
      { provider },
    );
    const { raw, events } = await collect(stream);

    // SSE wire 格式
    expect(raw).toContain("data: ");
    expect(raw.trimEnd().endsWith('data: {"type":"done"}')).toBe(true);

    // 7 个 Agent 全部启动，顺序为「并行分析 4 → 质疑 → 综合 → PRD」
    const startedIds = events
      .filter((e) => e.type === "agent:start")
      .map((e) => (e.type === "agent:start" ? e.agentId : ""));
    expect(startedIds).toEqual([
      "market",
      "user-research",
      "business",
      "interviewer",
      "devils-advocate",
      "synthesis",
      "prd",
    ]);

    // 每个 Agent 都有 done，且输出为 stub 回复（证明真实流式内容贯到底）
    const doneEvents = events.filter((e) => e.type === "agent:done");
    expect(doneEvents).toHaveLength(7);
    for (const e of doneEvents) {
      if (e.type !== "agent:done") continue;
      expect(e.output).toContain("端到端回复");
    }

    // 逐字 token 事件确实产生
    expect(events.some((e) => e.type === "agent:token")).toBe(true);
    // 全链路无错误
    expect(events.some((e) => e.type === "error")).toBe(false);
    // 以 done 收尾
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });
});
