/**
 * Stub LLM Server —— 模拟 OpenAI 兼容端点，用于本地验证与 e2e（无真实 key）。
 *
 * 用法：
 *   node e2e/stub-llm-server.mjs            # 默认监听 8787
 *   PORT=9000 node e2e/stub-llm-server.mjs
 *
 * 非流式请求（stream=false）返回一次性 JSON；
 * 流式请求（stream=true）按 CHUNK_DELAY_MS 逐段推送 SSE，模拟真实逐字输出。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const CHUNK_DELAY_MS = Number(process.env.CHUNK_DELAY_MS ?? 120);
const REPLY = process.env.REPLY ?? "竞品格局：该赛道竞争激烈，主要玩家各据一方。";

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

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
          choices: [{ message: { role: "assistant", content: REPLY } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const parts = [...REPLY];
    let i = 0;
    const timer = setInterval(() => {
      if (i >= parts.length) {
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
        res.end();
        return;
      }
      const delta = { choices: [{ delta: { content: parts[i++] } }] };
      res.write(`data: ${JSON.stringify(delta)}\n\n`);
    }, CHUNK_DELAY_MS);

    res.on("close", () => clearInterval(timer));
  });
});

server.listen(PORT, () => {
  console.log(`stub LLM server listening on http://localhost:${PORT}`);
});
