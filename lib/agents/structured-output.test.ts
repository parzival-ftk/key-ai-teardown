import { describe, it, expect } from "vitest";
import { parseStructuredOutput, findMetadataStart } from "./structured-output";

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

  it("容忍只有 1 个反引号的围栏（真实模型实测会这么写）", () => {
    const raw =
      '正文\n`json\n{"confidence":60,"evidence":[{"claim":"A","label":"inferred"}]}\n```';
    const out = parseStructuredOutput(raw);
    expect(out.text).toBe("正文");
    expect(out.confidence).toBe(60);
    expect(out.evidence).toHaveLength(1);
  });

  it("无围栏时兜底提取末尾裸 JSON 对象", () => {
    const raw =
      '正文\n{"confidence":55,"evidence":[{"claim":"B","label":"missing"}]}';
    const out = parseStructuredOutput(raw);
    expect(out.text).toBe("正文");
    expect(out.confidence).toBe(55);
    expect(out.evidence[0].claim).toBe("B");
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

describe("parseStructuredOutput（W15：addressed_critic_ids）", () => {
  it("解析 PRD 声明的已回应质疑 id", () => {
    const raw = [
      "PRD 正文 [C1] [C2]",
      "```json",
      '{"confidence":70,"addressed_critic_ids":["C1","C2"]}',
      "```",
    ].join("\n");
    const out = parseStructuredOutput(raw);
    expect(out.text).toBe("PRD 正文 [C1] [C2]");
    expect(out.addressedCriticIds).toEqual(["C1", "C2"]);
  });

  it("无该字段时为空数组（不 undefined，消费方不必判空）", () => {
    const out = parseStructuredOutput('正文\n```json\n{"confidence":50}\n```');
    expect(out.addressedCriticIds).toEqual([]);
  });

  it("末尾裸 JSON（无围栏）也能识别该字段", () => {
    const out = parseStructuredOutput(
      '正文\n{"addressed_critic_ids":["C3"]}',
    );
    expect(out.text).toBe("正文");
    expect(out.addressedCriticIds).toEqual(["C3"]);
  });

  it("折叠元数据区时把该关键词也算作起点（流式不泄漏）", () => {
    expect(findMetadataStart('正文\n{"addressed_critic_ids":["C1"]}')).toBeGreaterThan(0);
  });
});
