import { describe, it, expect } from "vitest";
import { parseStructuredOutput } from "./structured-output";

describe("parseStructuredOutput（证据标签解析）", () => {
  it("剥离结尾 JSON 块，返回正文与元数据", () => {
    const raw = [
      "这是分析正文。",
      "",
      "```json",
      '{"confidence": 80, "evidence": [{"claim": "A", "label": "inferred"}]}',
      "```",
    ].join("\n");

    const out = parseStructuredOutput(raw);
    expect(out.text).toBe("这是分析正文。");
    expect(out.confidence).toBe(80);
    expect(out.evidence).toEqual([{ claim: "A", label: "inferred" }]);
  });

  it("无 JSON 块时原样返回正文、证据为空", () => {
    const out = parseStructuredOutput("只有正文");
    expect(out.text).toBe("只有正文");
    expect(out.confidence).toBeUndefined();
    expect(out.evidence).toEqual([]);
  });

  it("非法 JSON 降级为纯文本（不抛错）", () => {
    const raw = "正文\n```json\n{坏掉的 json\n```";
    expect(() => parseStructuredOutput(raw)).not.toThrow();
    expect(parseStructuredOutput(raw).evidence).toEqual([]);
  });

  it("schema 不符（confidence 越界）时降级、不采纳元数据", () => {
    const raw = '正文\n```json\n{"confidence": 999}\n```';
    const out = parseStructuredOutput(raw);
    expect(out.confidence).toBeUndefined();
    expect(out.evidence).toEqual([]);
  });

  it("带 source 的 verified 证据被保留", () => {
    const raw = [
      "正文",
      "```json",
      '{"evidence":[{"claim":"X","label":"verified","source":"https://x.com"}]}',
      "```",
    ].join("\n");
    const out = parseStructuredOutput(raw);
    expect(out.evidence[0].source).toBe("https://x.com");
  });
});
