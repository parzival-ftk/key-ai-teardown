import { describe, it, expect } from "vitest";
import { interviewer } from "./interviewer";
import { parseProductBrief } from "@/lib/types/brief";
import type { AgentResult } from "@/lib/types/agent";

const brief = parseProductBrief({
  name: "Notion",
  description: "协作文档工具",
});

function result(agentId: string, output: string, failed = false): AgentResult {
  return { agentId, output, evidence: [], failed };
}

describe("访谈官框架：画像先行（W4）", () => {
  it("无前序结果时走软降级：提示自行立 persona", () => {
    const p = interviewer.userPrompt(brief, []);
    expect(p).toContain("Notion");
    expect(p).toMatch(/未获得|自行/);
  });

  it("研究员失败（失败标记或空产出）时不采用，走软降级", () => {
    expect(
      interviewer.userPrompt(brief, [result("user-research", "", true)]),
    ).toMatch(/未获得|自行/);
    expect(
      interviewer.userPrompt(brief, [result("user-research", "   ")]),
    ).toMatch(/未获得|自行/);
  });

  it("研究员有产出时，其画像被注入 prompt 作为访谈对象", () => {
    const persona = "Persona-A 知识管家：把 Notion 当作第二大脑。";
    const p = interviewer.userPrompt(brief, [result("user-research", persona)]);
    expect(p).toContain(persona);
    expect(p).toMatch(/访谈对象|以此为/);
  });

  it("只筛 user-research 的结果，不误用其他 Agent 的产出", () => {
    const p = interviewer.userPrompt(brief, [
      result("market", "市场分析内容XYZ"),
      result("user-research", "研究员画像ABC"),
    ]);
    expect(p).toContain("研究员画像ABC");
    expect(p).not.toContain("市场分析内容XYZ");
  });
});
