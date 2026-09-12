import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { LLMError } from "../provider";

const BASE = {
  baseURL: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
};

function jsonFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

function streamFetch(chunks: string[]): typeof fetch {
  const encoder = new TextEncoder();
  return vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("OpenAICompatibleProvider", () => {
  it("构造时校验必填项", () => {
    expect(() => new OpenAICompatibleProvider({ ...BASE, baseURL: "" })).toThrow(
      LLMError,
    );
    expect(() => new OpenAICompatibleProvider({ ...BASE, apiKey: "" })).toThrow(
      LLMError,
    );
    expect(() => new OpenAICompatibleProvider({ ...BASE, model: "" })).toThrow(
      LLMError,
    );
  });

  it("chat 发起正确请求并解析响应与 usage", async () => {
    const fetchImpl = jsonFetch({
      model: "deepseek-chat",
      choices: [{ message: { content: "你好" } }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    });
    const provider = new OpenAICompatibleProvider({ ...BASE, fetchImpl });

    const result = await provider.chat([{ role: "user", content: "hi" }]);

    expect(result.content).toBe("你好");
    expect(result.usage?.totalTokens).toBe(8);

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("deepseek-chat");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("responseFormat=json 时带上 response_format", async () => {
    const fetchImpl = jsonFetch({ choices: [{ message: { content: "{}" } }] });
    const provider = new OpenAICompatibleProvider({ ...BASE, fetchImpl });
    await provider.chat([{ role: "user", content: "x" }], {
      responseFormat: "json",
    });
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("chat 响应缺少 content 时抛 LLMError", async () => {
    const provider = new OpenAICompatibleProvider({
      ...BASE,
      fetchImpl: jsonFetch({ choices: [] }),
    });
    await expect(
      provider.chat([{ role: "user", content: "x" }]),
    ).rejects.toBeInstanceOf(LLMError);
  });

  it("HTTP 非 2xx 抛出带 status 的 LLMError", async () => {
    const provider = new OpenAICompatibleProvider({
      ...BASE,
      fetchImpl: jsonFetch({ error: "Unauthorized" }, 401),
    });
    await expect(
      provider.chat([{ role: "user", content: "x" }]),
    ).rejects.toMatchObject({ name: "LLMError", status: 401 });
  });

  it("chatStream 逐段产出 delta，正确处理跨 chunk 边界", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      // 故意在 JSON 中间切断，模拟网络分片
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: {"choi',
      'ces":[{"delta":{"content":"！"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const provider = new OpenAICompatibleProvider({
      ...BASE,
      fetchImpl: streamFetch(chunks),
    });

    const out: string[] = [];
    for await (const delta of provider.chatStream([
      { role: "user", content: "x" },
    ])) {
      out.push(delta);
    }
    expect(out.join("")).toBe("你好！");
  });

  it("chatStream flush 最后一行（上游不以换行结尾时该 delta 不丢）", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"甲"}}]}\n\n',
      // 最后一行没有结尾的 \n\n —— 应在流结束时被 flush
      'data: {"choices":[{"delta":{"content":"乙"}}]}',
    ];
    const provider = new OpenAICompatibleProvider({
      ...BASE,
      fetchImpl: streamFetch(chunks),
    });

    const out: string[] = [];
    for await (const delta of provider.chatStream([
      { role: "user", content: "x" },
    ])) {
      out.push(delta);
    }
    expect(out.join("")).toBe("甲乙");
  });
});
