import { describe, it, expect } from "vitest";
import {
  parseAgentEvent,
  isAgentEvent,
  serializeAgentEvent,
  deserializeAgentEvent,
} from "./events";

describe("AgentEvent 协议", () => {
  it("解析各类型事件", () => {
    expect(
      parseAgentEvent({ type: "agent:start", agentId: "market", name: "竞品分析师" }),
    ).toEqual({ type: "agent:start", agentId: "market", name: "竞品分析师" });

    expect(
      parseAgentEvent({ type: "agent:token", agentId: "market", delta: "你" }),
    ).toEqual({ type: "agent:token", agentId: "market", delta: "你" });

    expect(parseAgentEvent({ type: "done" })).toEqual({ type: "done" });
  });

  it("拒绝未知类型", () => {
    expect(isAgentEvent({ type: "nope" })).toBe(false);
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent("data: {}")).toBe(false);
  });

  it("agent:done 置信度越界被拒绝", () => {
    expect(() =>
      parseAgentEvent({
        type: "agent:done",
        agentId: "x",
        output: "y",
        confidence: 200,
      }),
    ).toThrow();
  });

  it("error 事件 agentId 可选", () => {
    expect(parseAgentEvent({ type: "error", message: "全局错误" })).toEqual({
      type: "error",
      message: "全局错误",
    });
  });

  it("serialize → deserialize 往返一致", () => {
    const event = {
      type: "agent:token",
      agentId: "market",
      delta: "你好",
    } as const;
    const wire = serializeAgentEvent(event);
    expect(wire.startsWith("data: ")).toBe(true);
    expect(wire.endsWith("\n\n")).toBe(true);
    expect(deserializeAgentEvent(wire)).toEqual(event);
  });

  it("deserialize 对非 data 行 / 非法 JSON 返回 null", () => {
    expect(deserializeAgentEvent("event: ping")).toBeNull();
    expect(deserializeAgentEvent("data: {bad json")).toBeNull();
    expect(deserializeAgentEvent("data: ")).toBeNull();
    expect(deserializeAgentEvent("data: {\"type\":\"unknown\"}")).toBeNull();
  });
});
