import { describe, it, expect } from "vitest";
import type { AgentEvent } from "@/lib/types/events";
import {
  parseReasoningTrace,
  summarizeReasoning,
  formatDuration,
  normalizeAgentId,
  UNLABELED_AGENT_ID,
} from "./reasoning-parser";

/** 便于构造带额外字段（如 at）的事件替身 */
const ev = (e: Record<string, unknown>): AgentEvent => e as unknown as AgentEvent;

describe("parseReasoningTrace：容错入口", () => {
  it("空字符串 / 纯空白 / 非字符串非数组 → 返回空数组，不抛错", () => {
    expect(parseReasoningTrace("")).toEqual([]);
    expect(parseReasoningTrace("   \n\t  ")).toEqual([]);
    expect(parseReasoningTrace(null as unknown as string)).toEqual([]);
    expect(parseReasoningTrace(undefined as unknown as AgentEvent[])).toEqual([]);
    expect(parseReasoningTrace(42 as unknown as string)).toEqual([]);
  });

  it("非标准文本（无任何结构标记）降级为纯文本步骤，按空行分段", () => {
    const steps = parseReasoningTrace("这是一段没有结构的日志。\n\n第二段内容。");
    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe("text");
    expect(steps[0].content).toBe("这是一段没有结构的日志。");
    expect(steps[1].kind).toBe("text");
    expect(steps[1].content).toBe("第二段内容。");
  });

  it("未闭合思考块整体降级为纯文本步骤（不抛错、不产出半截 thought）", () => {
    const steps = parseReasoningTrace("<thought>未闭合的思考\n继续往下写");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.kind === "text")).toBe(true);
    expect(steps.map((s) => s.content).join(" ")).toContain("未闭合的思考");
  });
});

describe("parseReasoningTrace：结构化文本（Thought/Action/Observation）", () => {
  const LOG = [
    "PrdAgent:",
    "Thought: 用户痛点是模板碎片化，**模板生态才是护城河**。",
    'Action: draft_prd("模板中心")',
    "Observation: 生成 5 条用户故事，耗时 1.2s",
    "",
    "RebuttalAgent:",
    "Thought: 结论：壁垒可能被抹平。",
  ].join("\n");

  const steps = parseReasoningTrace(LOG);

  it("按标记切分步骤并保持顺序", () => {
    expect(steps.map((s) => s.kind)).toEqual([
      "thought",
      "action",
      "observation",
      "thought",
    ]);
    expect(steps.map((s, i) => s.index === i)).toEqual([true, true, true, true]);
  });

  it("提取 Agent ID（含 kebab 归一化）", () => {
    expect(steps[0].agentId).toBe("prd");
    expect(steps[0].agentLabel).toBe("PrdAgent");
    expect(steps[3].agentId).toBe("rebuttal");
  });

  it("提取 Action 动作名", () => {
    expect(steps[1].action).toBe("draft_prd");
    expect(steps[1].content).toBe('draft_prd("模板中心")');
  });

  it("提取关键推理断言（加粗优先、结论标记次之）", () => {
    expect(steps[0].assertion).toBe("模板生态才是护城河");
    expect(steps[3].assertion).toBe("壁垒可能被抹平");
  });

  it("提取耗时并从正文中剥离该标记", () => {
    expect(steps[2].durationMs).toBe(1200);
    expect(steps[2].content).toBe("生成 5 条用户故事，");
  });

  it("支持 [Label] 行内 Agent 标签", () => {
    const s = parseReasoningTrace("[market] Thought: 竞品在打价格战");
    expect(s).toHaveLength(1);
    expect(s[0].agentId).toBe("market");
    expect(s[0].content).toBe("竞品在打价格战");
  });

  it("支持毫秒耗时与括号耗时写法", () => {
    const s = parseReasoningTrace("Thought: 快速试探 [+350ms]");
    expect(s[0].durationMs).toBe(350);
    expect(s[0].content).toBe("快速试探");
  });

  it("闭合的思考块标签被识别为 thought 步骤", () => {
    const s = parseReasoningTrace(
      "[Thought] 应当先验证假设\n[/Thought]\n[Action] run_probe\n[/Action]",
    );
    expect(s.map((x) => x.kind)).toEqual(["thought", "action"]);
    expect(s[0].content).toBe("应当先验证假设");
    expect(s[1].action).toBe("run_probe");
  });

  it("无 Agent 标签的结构化步骤 agentId 缺省（归入未标注）", () => {
    const s = parseReasoningTrace("Thought: 独立思考");
    expect(s[0].agentId).toBeUndefined();
    expect(s[0].kind).toBe("thought");
  });
});

describe("parseReasoningTrace：AgentEvent[] 重建", () => {
  const events: AgentEvent[] = [
    ev({ type: "agent:start", agentId: "market", name: "竞品分析师", at: 1000 }),
    ev({ type: "agent:token", agentId: "market", delta: "分析" }),
    ev({ type: "agent:token", agentId: "market", delta: "中…" }),
    ev({ type: "agent:done", agentId: "market", output: "结论：壁垒来自生态。", at: 1500 }),
    ev({ type: "error", agentId: "prd", message: "超时" }),
    ev({ type: "done" }),
  ];

  const steps = parseReasoningTrace(events);

  it("agent:start → action 节点，agent:done → observation 节点", () => {
    expect(steps[0].kind).toBe("action");
    expect(steps[0].agentId).toBe("market");
    expect(steps[1].kind).toBe("observation");
    expect(steps[1].agentId).toBe("market");
    expect(steps[1].content).toBe("结论：壁垒来自生态。");
    expect(steps[1].assertion).toBe("壁垒来自生态");
  });

  it("用事件时间戳计算耗时", () => {
    expect(steps[1].durationMs).toBe(500);
  });

  it("error 事件 → 文本步骤，携带失败信息", () => {
    const err = steps.find((s) => s.kind === "text");
    expect(err).toBeTruthy();
    expect(err?.agentId).toBe("prd");
    expect(err?.content).toContain("超时");
  });

  it("done 事件不产出步骤", () => {
    expect(steps).toHaveLength(3);
  });

  it("事件数组中的非法元素被跳过（不抛错）", () => {
    const dirty = parseReasoningTrace([
      null as unknown as AgentEvent,
      ev({ type: "agent:done", agentId: "x", output: "ok" }),
    ]);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].content).toBe("ok");
  });
});

describe("summarizeReasoning：按 Agent 聚合", () => {
  it("统计步骤数、分类计数与累计耗时", () => {
    const steps = parseReasoningTrace(
      [
        "PrdAgent:",
        "Thought: 痛点是碎片化。",
        'Action: draft_prd("x")',
        "Observation: 生成 5 条用户故事，耗时 1.2s",
        "",
        "RebuttalAgent:",
        "Thought: 结论：壁垒可能被抹平。",
      ].join("\n"),
    );
    const summary = summarizeReasoning(steps);
    expect(summary).toHaveLength(2);

    const prd = summary.find((s) => s.agentId === "prd");
    expect(prd).toBeTruthy();
    expect(prd?.stepCount).toBe(3);
    expect(prd?.thoughtCount).toBe(1);
    expect(prd?.actionCount).toBe(1);
    expect(prd?.observationCount).toBe(1);
    expect(prd?.totalDurationMs).toBe(1200);
    expect(prd?.hasDuration).toBe(true);

    const rebuttal = summary.find((s) => s.agentId === "rebuttal");
    expect(rebuttal?.stepCount).toBe(1);
    expect(rebuttal?.hasDuration).toBe(false);
  });

  it("无 Agent 标签的步骤归入未标注分组", () => {
    const summary = summarizeReasoning(parseReasoningTrace("Thought: 独立"));
    expect(summary[0].agentId).toBe(UNLABELED_AGENT_ID);
  });

  it("空输入 → 空摘要", () => {
    expect(summarizeReasoning([])).toEqual([]);
  });
});

describe("formatDuration / normalizeAgentId", () => {
  it("格式化毫秒", () => {
    expect(formatDuration(350)).toBe("350ms");
    expect(formatDuration(1200)).toBe("1.2s");
    expect(formatDuration(2000)).toBe("2s");
    expect(formatDuration(65000)).toBe("1m5s");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(Number.NaN)).toBe("0ms");
  });

  it("归一化 Agent 标签 → id", () => {
    expect(normalizeAgentId("PrdAgent")).toBe("prd");
    expect(normalizeAgentId("RebuttalAgent")).toBe("rebuttal");
    expect(normalizeAgentId("DevilsAdvocateAgent")).toBe("devils-advocate");
    expect(normalizeAgentId("market")).toBe("market");
    expect(normalizeAgentId("UnknownAgent")).toBe("unknown");
    expect(normalizeAgentId("")).toBeUndefined();
    expect(normalizeAgentId("思考")).toBeUndefined();
  });
});
