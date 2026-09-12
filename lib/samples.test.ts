import { describe, it, expect } from "vitest";
import { SAMPLE_REPORT } from "./samples";
import { REPORT_SECTIONS } from "@/lib/report/sections";
import { EvidenceLabelSchema } from "@/lib/types/evidence";

describe("内置样例报告（W2：可信度层贯通）", () => {
  it("覆盖全部报告章节，顺序与 REPORT_SECTIONS 一致", () => {
    expect(SAMPLE_REPORT.sections.map((s) => s.agentId)).toEqual(
      REPORT_SECTIONS.map((s) => s.agentId),
    );
  });

  it("每段都有置信度与证据标签（样例页能演示可信度层）", () => {
    for (const section of SAMPLE_REPORT.sections) {
      expect(typeof section.confidence, section.agentId).toBe("number");
      expect(section.evidence.length, section.agentId).toBeGreaterThan(0);
      for (const e of section.evidence) {
        expect(
          EvidenceLabelSchema.safeParse(e.label).success,
          `${section.agentId}: ${e.label}`,
        ).toBe(true);
      }
    }
  });

  it("样例同时演示三种标签（已核实 / 推测 / 缺失）", () => {
    const labels = new Set(
      SAMPLE_REPORT.sections.flatMap((s) => s.evidence.map((e) => e.label)),
    );
    expect(labels).toEqual(new Set(["verified", "inferred", "missing"]));
  });
});
