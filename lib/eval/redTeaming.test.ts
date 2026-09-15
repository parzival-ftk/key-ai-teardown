import { describe, it, expect } from "vitest";
import {
  extractMetricStatements,
  findContradictions,
  runRedTeam,
  sanitizeReport,
} from "./redTeaming";
import type { EvaluableReport } from "./judgeAgent";
import type { Evidence } from "@/lib/types/evidence";

const INPUT = "Notion 是一款协作文档工具，主要面向中小团队。";

const report = (
  sections: Array<{ agentId: string; output: string; evidence?: Evidence[] }>,
): EvaluableReport => ({ name: "Notion", sections });

describe("extractMetricStatements（矛盾/虚构识别的基础）", () => {
  it("抽出「指标词 + 具体数值」的断言", () => {
    const st = extractMetricStatements(
      report([
        {
          agentId: "market",
          output: "该赛道市场规模约 40 亿美元，增速很快。用户数约 200 万。",
        },
      ]),
    );
    expect(st).toHaveLength(2);
    expect(st[0]).toMatchObject({ term: "市场规模", sectionId: "market" });
    expect(st[1].term).toBe("用户数");
  });

  it("只有指标词或只有数字都不算", () => {
    expect(
      extractMetricStatements(
        report([{ agentId: "market", output: "市场规模很大但没有具体数字。这里有 40 个模板。" }]),
      ),
    ).toEqual([]);
  });

  it("空报告 → 空数组", () => {
    expect(extractMetricStatements(report([]))).toEqual([]);
  });
});

describe("findContradictions", () => {
  it("同一指标在不同段给出不同数值 → 判为矛盾", () => {
    const st = extractMetricStatements(
      report([
        { agentId: "market", output: "市场规模约 40 亿美元。" },
        { agentId: "business", output: "该市场规模约 80 亿美元。" },
      ]),
    );
    const conflicts = findContradictions(st);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].term).toBe("市场规模");
  });

  it("数值一致或同段内不同数值 → 不算矛盾", () => {
    const same = extractMetricStatements(
      report([
        { agentId: "market", output: "市场规模约 40 亿美元。" },
        { agentId: "business", output: "市场规模约 40 亿美元。" },
      ]),
    );
    expect(findContradictions(same)).toEqual([]);

    const oneSection = extractMetricStatements(
      report([{ agentId: "market", output: "市场规模 40 亿。另一口径 80 亿。" }]),
    );
    expect(findContradictions(oneSection)).toEqual([]);
  });
});

describe("runRedTeam · 虚构引用拦截", () => {
  it("verified 无来源 → 强制降级为 inferred（conjecture），并记入日志", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "壁垒很高。",
          evidence: [
            { claim: "壁垒很高", label: "verified" },
            { claim: "有来源的", label: "verified", source: "notion.so" },
          ],
        },
      ]),
    );
    expect(r.blockedCount).toBe(1);
    expect(r.downgrades[0]).toMatchObject({
      sectionId: "market",
      evidenceIndex: 0,
      from: "verified",
      to: "inferred",
    });
    expect(r.findings[0].kind).toBe("fabricated_citation");
    expect(r.findings[0].severity).toBe("blocked");
  });

  it("给了核验语料时，来源不在语料内也算虚构", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "正文",
          evidence: [{ claim: "X", label: "verified", source: "某咨询报告" }],
        },
      ]),
      { inputText: INPUT },
    );
    expect(r.blockedCount).toBe(1);
    expect(r.downgrades[0].reason).toContain("无法在本次输入中核验");
  });

  it("来源可核验 → 不拦截", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "正文",
          evidence: [{ claim: "X", label: "verified", source: "中小团队" }],
        },
      ]),
      { inputText: INPUT },
    );
    expect(r.blockedCount).toBe(0);
    expect(r.findings).toEqual([]);
  });

  it("inferred / missing 不参与降级（只盯 verified）", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "正文",
          evidence: [
            { claim: "A", label: "inferred" },
            { claim: "B", label: "missing" },
          ],
        },
      ]),
    );
    expect(r.findings).toEqual([]);
  });
});

describe("runRedTeam · 虚构数值与矛盾", () => {
  it("段内有具体数值却无可追溯来源 → 拦截该段", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "该赛道市场规模约 40 亿美元。",
          evidence: [{ claim: "市场规模很大", label: "verified" }],
        },
      ]),
    );
    const metric = r.findings.find((f) => f.kind === "unsupported_metric");
    expect(metric).toBeDefined();
    expect(metric!.severity).toBe("blocked");
    expect(r.downgrades.some((d) => d.to === "missing")).toBe(true);
  });

  it("有可追溯来源时不判为虚构数值", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "该赛道市场规模约 40 亿美元。",
          evidence: [{ claim: "数据来自公开财报", label: "verified", source: "notion.so" }],
        },
      ]),
    );
    expect(r.findings.some((f) => f.kind === "unsupported_metric")).toBe(false);
  });

  it("跨段矛盾会被记录（两侧都无来源时降级为 missing）", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "市场规模约 40 亿美元。",
          evidence: [{ claim: "规模 40 亿", label: "verified" }],
        },
        {
          agentId: "business",
          output: "市场规模约 80 亿美元。",
          evidence: [{ claim: "规模 80 亿", label: "verified" }],
        },
      ]),
    );
    const contradiction = r.findings.find((f) => f.kind === "contradiction");
    expect(contradiction).toBeDefined();
    expect(contradiction!.detail).toContain("40亿");
    expect(contradiction!.detail).toContain("80亿");
    expect(r.downgrades.every((d) => d.to === "missing")).toBe(true);
  });

  it("同一证据被多条规则命中时只降级一次，且取更重的 missing", () => {
    const r = runRedTeam(
      report([
        {
          agentId: "market",
          output: "市场规模约 40 亿美元。",
          evidence: [{ claim: "规模 40 亿", label: "verified" }],
        },
        {
          agentId: "business",
          output: "市场规模约 80 亿美元。",
          evidence: [{ claim: "规模 80 亿", label: "verified" }],
        },
      ]),
    );
    const keys = r.downgrades.map((d) => `${d.sectionId}#${d.evidenceIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("空报告 → 无发现、无降级（不崩）", () => {
    const r = runRedTeam(report([]));
    expect(r).toEqual({ findings: [], blockedCount: 0, downgrades: [] });
  });
});

describe("sanitizeReport（把降级真正落到报告上）", () => {
  it("按拦截结果改写标签，且不改动入参", () => {
    const original = report([
      {
        agentId: "market",
        output: "壁垒很高。",
        evidence: [
          { claim: "壁垒很高", label: "verified" },
          { claim: "有来源的", label: "verified", source: "notion.so" },
        ],
      },
    ]);
    const redTeam = runRedTeam(original);
    const sanitized = sanitizeReport(original, redTeam);

    expect(sanitized.sections[0].evidence?.[0].label).toBe("inferred");
    expect(sanitized.sections[0].evidence?.[1].label).toBe("verified");
    // 入参未被修改（纯函数）
    expect(original.sections[0].evidence?.[0].label).toBe("verified");
  });

  it("无降级时原样返回同一个引用（省一次渲染）", () => {
    const clean = report([{ agentId: "market", output: "正文" }]);
    expect(sanitizeReport(clean, runRedTeam(clean))).toBe(clean);
  });
});
