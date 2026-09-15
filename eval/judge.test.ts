import { describe, it, expect } from "vitest";
import { buildJudgeMessages, parseJudgeOutput } from "./judge";
import { RUBRIC } from "./rubric";

const [D1, D2, D3, D4] = RUBRIC.map((d) => d.id);

describe("buildJudgeMessages", () => {
  it("为 system+user，且 user 消息含全部维度 id 与报告正文", () => {
    const msgs = buildJudgeMessages({
      id: "x",
      name: "示例产品",
      reportText: "报告正文ABC",
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");

    const userText = typeof msgs[1].content === "string" ? msgs[1].content : "";
    for (const dim of RUBRIC) expect(userText).toContain(dim.id);
    expect(userText).toContain("报告正文ABC");
    expect(userText).toContain("示例产品");
  });
});

describe("parseJudgeOutput", () => {
  it("解析围栏 JSON，保留分数与理由", () => {
    const raw = [
      "评审如下：",
      "```json",
      JSON.stringify({
        scores: { [D1]: 80, [D2]: 70, [D3]: 90, [D4]: 60 },
        rationale: { [D1]: "结构完整" },
      }),
      "```",
    ].join("\n");
    const verdict = parseJudgeOutput(raw);
    expect(verdict?.scores).toMatchObject({ [D1]: 80, [D3]: 90, [D4]: 60 });
    expect(verdict?.rationale[D1]).toBe("结构完整");
  });

  it("解析无围栏的裸 JSON", () => {
    const raw = JSON.stringify({ scores: { [D1]: 55 } });
    expect(parseJudgeOutput(raw)?.scores).toEqual({ [D1]: 55 });
  });

  it("只采纳维度表内、且为数字的维度分", () => {
    const raw = JSON.stringify({
      scores: { [D1]: 80, unknown: 90, [D2]: "70" },
    });
    expect(parseJudgeOutput(raw)?.scores).toEqual({ [D1]: 80 });
  });

  it("无有效分数返回 null（不抛错）", () => {
    expect(parseJudgeOutput("没有 JSON")).toBeNull();
    expect(parseJudgeOutput("{坏 json")).toBeNull();
    expect(parseJudgeOutput('{"scores":{}}')).toBeNull();
    expect(
      parseJudgeOutput(JSON.stringify({ scores: { [D1]: "80" } })),
    ).toBeNull();
  });
});
