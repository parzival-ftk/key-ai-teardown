import { describe, it, expect } from "vitest";
import type { LLMProvider } from "@/lib/llm/provider";
import {
  parseDiagramFromImage,
  extractDiagramCode,
  sanitizeMermaidNodeIds,
  sanitizeNodeId,
  countDiagramNodes,
  detectDiagramType,
  scoreDiagramConfidence,
  FALLBACK_DIAGRAM_CODE,
  type DiagramVisionRequest,
} from "./vision-parser";
import { DIAGRAM_VISION_SYSTEM_PROMPT, buildStubDiagram } from "./vision-prompt";
import { diagnoseMermaid, hasBlockingDiagnostic } from "./diagram-lint";

/** 合法的小体积图片 data（内容不重要，校验只看格式） */
const REQ: DiagramVisionRequest = {
  imageBase64: "aGVsbG8=",
  mimeType: "image/png",
};

interface CapturedProvider {
  provider: LLMProvider;
  calls: { messages: unknown }[];
}

function fakeProvider(content: string): CapturedProvider {
  const calls: { messages: unknown }[] = [];
  const provider: LLMProvider = {
    id: "fake",
    model: "fake-model",
    async chat(messages) {
      calls.push({ messages });
      return { content, model: "fake-model" };
    },
    async *chatStream() {
      yield content;
    },
  };
  return { provider, calls };
}

function failingProvider(message = "upstream 500"): LLMProvider {
  return {
    id: "boom",
    model: "boom-model",
    async chat() {
      throw new Error(message);
    },
    async *chatStream() {
      throw new Error(message);
    },
  };
}

describe("extractDiagramCode：围栏剥离与清洗", () => {
  it("取出 ```mermaid 围栏内容，丢弃围栏外的解释文字", () => {
    const raw = [
      "这是一张架构图。",
      "```mermaid",
      "flowchart TD",
      "  A[用户] --> B[服务]",
      "```",
      "以上。",
    ].join("\n");
    expect(extractDiagramCode(raw)).toBe(
      "flowchart TD\n  A[用户] --> B[服务]",
    );
  });

  it("无 mermaid 关键字但有围栏标记时，剥掉 ``` 行而非吞掉正文", () => {
    const raw = "```flowchart TD\n  A[用户] --> B[服务]\n```";
    expect(extractDiagramCode(raw)).toBe(
      "flowchart TD\n  A[用户] --> B[服务]",
    );
  });

  it("清洗含空格与特殊符号的节点 ID，且不动节点标签", () => {
    const raw = [
      "```mermaid",
      "flowchart TD",
      "  Node 1[用户 登录] --> Node-2[服务]",
      "  Node-2 --> Invalid.Id[缓存]",
      "```",
    ].join("\n");
    const code = extractDiagramCode(raw);
    expect(code).toContain("Node_1[用户 登录]");
    expect(code).toContain("Node-2[服务]");
    expect(code).toContain("Invalid_Id[缓存]");
    expect(code).not.toContain("Node 1[");
    // 标签原样保留
    expect(code).toContain("[用户 登录]");
  });

  it("非法输入返回空串（不抛错）", () => {
    expect(extractDiagramCode("")).toBe("");
    expect(extractDiagramCode(null as unknown as string)).toBe("");
  });
});

describe("sanitizeNodeId / detectDiagramType / countDiagramNodes", () => {
  it("合法 id 原样保留，非法字符替换为下划线", () => {
    expect(sanitizeNodeId("A")).toBe("A");
    expect(sanitizeNodeId("Node-1")).toBe("Node-1");
    expect(sanitizeNodeId("Node 1")).toBe("Node_1");
    expect(sanitizeNodeId("a.b")).toBe("a_b");
    expect(sanitizeNodeId("1st")).toBe("N1st");
    expect(sanitizeNodeId("***")).toBe("N");
    expect(sanitizeNodeId("用户")).toBe("用户");
  });

  it("识别图形类型（跳过注释行）", () => {
    expect(detectDiagramType("%% 注释\nflowchart LR\n A-->B")).toBe("flowchart");
    expect(detectDiagramType("graph TD\n A-->B")).toBe("flowchart");
    expect(detectDiagramType("stateDiagram-v2\n [*] --> X")).toBe(
      "stateDiagram-v2",
    );
    expect(detectDiagramType("A[用户]")).toBe("unknown");
    expect(detectDiagramType("")).toBe("unknown");
  });

  it("节点计数不含图形关键字、方向、边标签与转移说明", () => {
    const code = [
      "flowchart TD",
      "  U[用户] -->|HTTPS| GW[网关]",
      "  GW --> DB[(库)]",
      "  GW --> U",
    ].join("\n");
    expect(countDiagramNodes(code)).toBe(3); // U / GW / DB

    const state = [
      "stateDiagram-v2",
      "  [*] --> 待处理",
      "  待处理 --> 处理中: 领取任务",
      "  处理中 --> [*]",
    ].join("\n");
    expect(countDiagramNodes(state)).toBe(2); // 待处理 / 处理中
  });

  it("置信度：空码 0 分，结构完整的图更高分且不超过 100", () => {
    expect(scoreDiagramConfidence("", 0, 0)).toBe(0);
    const simple = scoreDiagramConfidence("A[用户]", 1, 0);
    const rich = scoreDiagramConfidence("flowchart TD\n A-->B", 5, 4);
    expect(rich).toBeGreaterThan(simple);
    expect(rich).toBeLessThanOrEqual(100);
  });
});

describe("parseDiagramFromImage：模型路径", () => {
  it("从模型回复中提取代码并给出结构化结果", async () => {
    const { provider } = fakeProvider(
      "这是架构图：\n```mermaid\nflowchart TD\n  A[用户] --> B[服务]\n```",
    );
    const r = await parseDiagramFromImage(REQ, { provider });
    expect(r.source).toBe("model");
    expect(r.code).toBe("flowchart TD\n  A[用户] --> B[服务]");
    expect(r.diagramType).toBe("flowchart");
    expect(r.detectedNodesCount).toBe(2);
    expect(r.confidenceScore).toBeGreaterThan(0);
    expect(r.error).toBeUndefined();
  });

  it("按多模态协议发送：文本 + image_url(data URL)", async () => {
    const { provider, calls } = fakeProvider("```mermaid\nflowchart TD\n A-->B\n```");
    await parseDiagramFromImage({ imageBase64: "aGVsbG8=", mimeType: "image/webp" }, {
      provider,
    });
    const messages = calls[0].messages as {
      content: unknown;
    }[];
    const userContent = messages[messages.length - 1].content as {
      type: string;
      text?: string;
      image_url?: { url: string };
    }[];
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent[0].type).toBe("text");
    expect(userContent[1].type).toBe("image_url");
    expect(userContent[1].image_url?.url).toBe("data:image/webp;base64,aGVsbG8=");
  });

  it("模型回话（无 mermaid 结构）→ 降级为安全默认结构，不把散文当图谱", async () => {
    const { provider } = fakeProvider("我无法识别这张图，请重新上传。");
    const r = await parseDiagramFromImage(REQ, { provider });
    expect(r.source).toBe("fallback");
    expect(r.code).toBe(FALLBACK_DIAGRAM_CODE);
    expect(r.diagramType).toBe("flowchart");
    expect(r.confidenceScore).toBe(0);
    expect(r.detectedNodesCount).toBe(0);
    // 模型原话片段进 error，便于排障
    expect(r.error).toContain("无法识别");
  });
});

describe("parseDiagramFromImage：容错降级（绝不抛错）", () => {
  it("非图像 MIME → fallback 并标记 error", async () => {
    const r = await parseDiagramFromImage(
      { imageBase64: "aGVsbG8=", mimeType: "application/pdf" },
      { stub: true },
    );
    expect(r.source).toBe("fallback");
    expect(r.error).toBeTruthy();
    expect(r.confidenceScore).toBe(0);
    expect(r.code).toBe(FALLBACK_DIAGRAM_CODE);
    expect(r.detectedNodesCount).toBe(0);
  });

  it("空图片内容 → fallback", async () => {
    const r = await parseDiagramFromImage(
      { imageBase64: "", mimeType: "image/png" },
      { stub: true },
    );
    expect(r.source).toBe("fallback");
    expect(r.error).toBeTruthy();
  });

  it("损坏的 base64 → fallback", async () => {
    const r = await parseDiagramFromImage(
      { imageBase64: "not base64!!!", mimeType: "image/png" },
      { stub: true },
    );
    expect(r.source).toBe("fallback");
    expect(r.error).toBeTruthy();
  });

  it("请求体本身非法（null）→ fallback，不抛错", async () => {
    const r = await parseDiagramFromImage(
      null as unknown as DiagramVisionRequest,
      { stub: true },
    );
    expect(r.source).toBe("fallback");
    expect(r.confidenceScore).toBe(0);
  });

  it("API 异常 → fallback，错误信息透传", async () => {
    const r = await parseDiagramFromImage(REQ, { provider: failingProvider("上游 503") });
    expect(r.source).toBe("fallback");
    expect(r.error).toContain("503");
    expect(r.code).toBe(FALLBACK_DIAGRAM_CODE);
  });

  it("模型返回空内容 → fallback", async () => {
    const { provider } = fakeProvider("   ");
    const r = await parseDiagramFromImage(REQ, { provider });
    expect(r.source).toBe("fallback");
    expect(r.error).toBeTruthy();
  });
});

describe("Stub 兜底（无 Key 环境下的确定性模拟）", () => {
  it("同一请求两次调用结果逐字一致", async () => {
    const a = await parseDiagramFromImage(REQ, { stub: true });
    const b = await parseDiagramFromImage(REQ, { stub: true });
    expect(a).toEqual(b);
    expect(a.source).toBe("stub");
  });

  it("不同输入的 Stub 结果由输入特征决定（可复现）", () => {
    const one = buildStubDiagram({ imageBase64: "aGVsbG8=", mimeType: "image/png" });
    const two = buildStubDiagram({ imageBase64: "aGVsbG8=", mimeType: "image/png" });
    expect(one).toEqual(two);
  });

  it("Stub 产出可解析的 mermaid（含图形关键字与节点）", async () => {
    const r = await parseDiagramFromImage(REQ, { stub: true });
    expect(detectDiagramType(r.code)).not.toBe("unknown");
    expect(r.detectedNodesCount).toBeGreaterThan(0);
    expect(r.confidenceScore).toBeGreaterThan(0);
    expect(r.error).toBeUndefined();
  });

  it("diagramTypeHint 影响 Stub 的图类型", async () => {
    const state = await parseDiagramFromImage(
      { ...REQ, diagramTypeHint: "state" },
      { stub: true },
    );
    expect(state.code.startsWith("stateDiagram-v2")).toBe(true);
    const flow = await parseDiagramFromImage(
      { ...REQ, diagramTypeHint: "flowchart" },
      { stub: true },
    );
    expect(/^flowchart/.test(flow.code)).toBe(true);
  });

  it("Stub 产出通过项目自身的图谱诊断（不是伪造的合法结构）", async () => {
    for (const hint of [undefined, "flowchart", "state"]) {
      const r = await parseDiagramFromImage(
        { ...REQ, diagramTypeHint: hint },
        { stub: true },
      );
      expect(hasBlockingDiagnostic(diagnoseMermaid(r.code))).toBe(false);
    }
  });

  it("未配置 LLM key 时自动回退到 Stub（不抛错）", async () => {
    const saved = {
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
    };
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    try {
      const r = await parseDiagramFromImage(REQ);
      expect(r.source).toBe("stub");
      expect(r.code.length).toBeGreaterThan(0);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("多模态 Prompt 策略", () => {
  it("指导方向（TD/LR）与全部边类型", () => {
    for (const token of ["TD", "LR", "-->", "-.->", "==>", "->>"]) {
      expect(DIAGRAM_VISION_SYSTEM_PROMPT).toContain(token);
    }
    expect(DIAGRAM_VISION_SYSTEM_PROMPT).toContain("mermaid");
  });
});

describe("sanitizeMermaidNodeIds 边界", () => {
  it("保留 subgraph / classDef / 注释等结构行原样", () => {
    const code = [
      "flowchart TD",
      "  %% 注释 保留 空格",
      "  subgraph 我的 系统",
      "    A[用户] --> B[服务]",
      "  end",
      "  classDef big fill:#f00",
    ].join("\n");
    const out = sanitizeMermaidNodeIds(code);
    expect(out).toContain("%% 注释 保留 空格");
    expect(out).toContain("subgraph 我的 系统");
    expect(out).toContain("classDef big fill:#f00");
  });
});
