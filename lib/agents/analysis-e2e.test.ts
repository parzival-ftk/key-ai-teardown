import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
 *   → 真实编排（并行 3 + 串行 4，W4 后访谈官移入串行组）
 *   → 真实 SSE 序列化
 * 中间层一律不 mock；只有上游 LLM 是一个本地 HTTP stub。
 *
 * W4：stub 不再对**所有 Agent 返回同一句话**（那会让内容一致性问题结构上不可见），
 * 改为按 system prompt 识别 Agent 返回不同内容，并记录收到的请求——这样才能断言
 * 「研究员画像被注入访谈官请求」这类链路行为。
 */

/** 研究员那条请求的独有标识（jtbd 框架的 systemPrompt 开头） */
const RESEARCHER_MARK = "专长是 JTBD";
/** 访谈官那条请求的独有标识（研究员 prompt 里也会提到「用户访谈官」，故须用带角色前缀的完整串） */
const INTERVIEWER_MARK = "你是 Key 的「用户访谈官」";

const RESEARCHER_REPLY = "研究员画像：Persona-A 知识管家；Persona-B 流程搭建者。";
const INTERVIEWER_REPLY = "访谈证言：作为知识管家，我最怕模板太多。";

function replyFor(system: string): string {
  if (system.includes(RESEARCHER_MARK)) return RESEARCHER_REPLY;
  if (system.includes(INTERVIEWER_MARK)) return INTERVIEWER_REPLY;
  return "通用回复：该赛道竞争激烈。";
}

interface CapturedRequest {
  system: string;
  user: string;
}

/** 真实 HTTP stub LLM server；captured 记录每个请求，failMark 命中时返回 500 */
function startStubServer(
  captured: CapturedRequest[],
  state: { failMark: string | null },
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        let body: {
          stream?: boolean;
          messages?: { role?: string; content?: unknown }[];
        } = {};
        try {
          body = JSON.parse(raw);
        } catch {
          body = {};
        }

        const messages = Array.isArray(body.messages) ? body.messages : [];
        const systemMsg = messages.find((m) => m.role === "system")?.content;
        const system = typeof systemMsg === "string" ? systemMsg : "";
        const userMsg = messages.find((m) => m.role === "user")?.content;
        const user =
          typeof userMsg === "string" ? userMsg : JSON.stringify(userMsg ?? "");
        captured.push({ system, user });

        // 错误注入：模拟某个 Agent 的上游失败（验证软降级 / 单点失败不阻塞）
        if (state.failMark && system.includes(state.failMark)) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "injected failure" }));
          return;
        }

        const reply = replyFor(system);
        const stream = body.stream === true;

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

function makeProvider(baseURL: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseURL,
    apiKey: "sk-stub",
    model: "stub-model",
  });
}

const brief = parseProductBrief({
  name: "Notion",
  description: "协作文档工具",
});

describe("端到端：真实 HTTP + 全编队（唯一替身是 stub LLM server）", () => {
  let server: Server;
  let baseURL: string;
  let captured: CapturedRequest[];
  let state: { failMark: string | null };

  beforeAll(async () => {
    captured = [];
    state = { failMark: null };
    const started = await startStubServer(captured, state);
    server = started.server;
    baseURL = `http://127.0.0.1:${started.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    captured.length = 0;
    state.failMark = null;
  });

  it("全编队经真实 HTTP 走完：7 个 Agent 逐个产出、SSE 格式正确、以 done 收尾、无 error", async () => {
    const stream = createAnalysisStream(brief, {
      provider: makeProvider(baseURL),
    });
    const { raw, events } = await collect(stream);

    // SSE wire 格式
    expect(raw).toContain("data: ");
    expect(raw.trimEnd().endsWith('data: {"type":"done"}')).toBe(true);

    // 7 个 Agent 全部启动
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

    // 每个 Agent 都有 done；差异化 stub 下输出不再千篇一律（W4 修 stub 盲区）
    const doneEvents = events.filter((e) => e.type === "agent:done");
    expect(doneEvents).toHaveLength(7);
    const outputs = doneEvents.map((e) =>
      e.type === "agent:done" ? e.output : "",
    );
    expect(new Set(outputs).size).toBeGreaterThan(1);

    // 逐字 token 事件确实产生
    expect(events.some((e) => e.type === "agent:token")).toBe(true);
    // 全链路无错误
    expect(events.some((e) => e.type === "error")).toBe(false);
    // 以 done 收尾
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("画像注入：访谈官的真实 HTTP 请求携带了研究员的产出（W4）", async () => {
    const stream = createAnalysisStream(brief, {
      provider: makeProvider(baseURL),
    });
    await collect(stream);

    const researchReq = captured.find((r) => r.system.includes(RESEARCHER_MARK));
    const interviewReq = captured.find((r) =>
      r.system.includes(INTERVIEWER_MARK),
    );
    expect(researchReq).toBeDefined();
    expect(interviewReq).toBeDefined();

    // 访谈官的请求里带上了研究员的产出 —— 画像先行的端到端证据
    expect(interviewReq!.user).toContain(RESEARCHER_REPLY);
  });

  it("研究员上游失败时访谈官软降级，仍产出且不阻塞整体（单点失败不阻塞）", async () => {
    state.failMark = RESEARCHER_MARK;
    const stream = createAnalysisStream(brief, {
      provider: makeProvider(baseURL),
    });
    const { events } = await collect(stream);

    // 研究员那条报错
    const errs = events.filter(
      (e) => e.type === "error" && e.agentId === "user-research",
    );
    expect(errs).toHaveLength(1);

    // 访谈官仍完成
    const interviewDone = events.find(
      (e) => e.type === "agent:done" && e.agentId === "interviewer",
    );
    expect(interviewDone).toBeDefined();
    expect(
      interviewDone && interviewDone.type === "agent:done"
        ? interviewDone.output
        : "",
    ).toContain("访谈证言");

    // 反向断言：走的是软降级分支 —— 访谈官请求里**不含**研究员画像，且带降级提示
    const interviewReq = captured.find((r) =>
      r.system.includes(INTERVIEWER_MARK),
    );
    expect(interviewReq).toBeDefined();
    expect(interviewReq!.user).not.toContain(RESEARCHER_REPLY);
    expect(interviewReq!.user).toContain("未获得研究员画像");

    // 整体仍以 done 收尾，未崩溃
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });
});
