import { describe, it, expect } from "vitest";
import {
  applyDagEvent,
  createInitialDagState,
  edgeFlow,
  nodeElapsedMs,
  summarizeDag,
  type DagState,
} from "./dag-state";
import type { AgentEvent } from "@/lib/types/events";

const IDS = ["a", "b"];

const run = (state: DagState, events: AgentEvent[], base = 1000): DagState =>
  events.reduce((s, event, i) => applyDagEvent(s, event, base + i * 10), state);

describe("createInitialDagState", () => {
  it("全部节点为 pending、无产出", () => {
    const state = createInitialDagState(IDS);
    expect(Object.keys(state)).toEqual(IDS);
    for (const id of IDS) {
      expect(state[id]).toEqual({
        status: "pending",
        output: "",
        chars: 0,
        startedAt: null,
        endedAt: null,
      });
    }
  });
});

describe("applyDagEvent（状态转换）", () => {
  it("agent:start → running，记录起始时间", () => {
    const state = run(createInitialDagState(IDS), [
      { type: "agent:start", agentId: "a", name: "A" },
    ]);
    expect(state.a.status).toBe("running");
    expect(state.a.startedAt).toBe(1000);
    expect(state.b.status).toBe("pending");
  });

  it("agent:token 累积产出并计数", () => {
    const state = run(createInitialDagState(IDS), [
      { type: "agent:start", agentId: "a", name: "A" },
      { type: "agent:token", agentId: "a", delta: "你好" },
      { type: "agent:token", agentId: "a", delta: "世界" },
    ]);
    expect(state.a.output).toBe("你好世界");
    expect(state.a.chars).toBe(4);
    expect(state.a.status).toBe("running");
  });

  it("agent:done → completed，以完整输出覆盖并记结束时间", () => {
    const state = run(createInitialDagState(IDS), [
      { type: "agent:start", agentId: "a", name: "A" },
      { type: "agent:token", agentId: "a", delta: "半截" },
      { type: "agent:done", agentId: "a", output: "完整输出", confidence: 80 },
    ]);
    expect(state.a.status).toBe("completed");
    expect(state.a.output).toBe("完整输出");
    expect(state.a.chars).toBe(4);
    expect(state.a.confidence).toBe(80);
    expect(state.a.endedAt).toBe(1020);
  });

  it("error → failed（带 agentId）", () => {
    const state = run(createInitialDagState(IDS), [
      { type: "agent:start", agentId: "a", name: "A" },
      { type: "error", agentId: "a", message: "boom" },
    ]);
    expect(state.a.status).toBe("failed");
    expect(state.a.endedAt).toBe(1010);
  });

  it("未知 agentId / 顶层 error / done 事件不改变状态（且返回原引用）", () => {
    const state = createInitialDagState(IDS);
    expect(applyDagEvent(state, { type: "agent:token", agentId: "ghost", delta: "x" }, 1)).toBe(state);
    expect(applyDagEvent(state, { type: "error", message: "顶层错误" }, 1)).toBe(state);
    expect(applyDagEvent(state, { type: "done" }, 1)).toBe(state);
  });

  it("重复 agent:start 是幂等的（返回原引用）", () => {
    const started = run(createInitialDagState(IDS), [
      { type: "agent:start", agentId: "a", name: "A" },
    ]);
    expect(
      applyDagEvent(started, { type: "agent:start", agentId: "a", name: "A" }, 9999),
    ).toBe(started);
  });
});

describe("nodeElapsedMs", () => {
  it("未开始 → null；进行中 → 至今；已结束 → 起止差", () => {
    const initial = createInitialDagState(IDS);
    expect(nodeElapsedMs(initial.a, 5000)).toBeNull();

    const running = run(initial, [{ type: "agent:start", agentId: "a", name: "A" }]);
    expect(nodeElapsedMs(running.a, 1500)).toBe(500);

    const done = applyDagEvent(
      running,
      { type: "agent:done", agentId: "a", output: "x" },
      2500,
    );
    // 已结束：起止差（不再随 now 变化）
    expect(nodeElapsedMs(done.a, 99999)).toBe(1500);
  });
});

describe("edgeFlow", () => {
  const started = (state: DagState, id: string) =>
    applyDagEvent(state, { type: "agent:start", agentId: id, name: id }, 1);
  const finished = (state: DagState, id: string) =>
    applyDagEvent(state, { type: "agent:done", agentId: id, output: "x" }, 2);

  it("父已完成 + 子运行中 → flowing", () => {
    let state = createInitialDagState(IDS);
    state = finished(started(state, "a"), "a");
    state = started(state, "b");
    expect(edgeFlow({ from: "a", to: "b" }, state)).toBe("flowing");
  });

  it("两端都完成 → settled", () => {
    let state = createInitialDagState(IDS);
    state = finished(started(state, "a"), "a");
    state = finished(started(state, "b"), "b");
    expect(edgeFlow({ from: "a", to: "b" }, state)).toBe("settled");
  });

  it("其它情况 → idle（含端点未知）", () => {
    const state = createInitialDagState(IDS);
    expect(edgeFlow({ from: "a", to: "b" }, state)).toBe("idle");
    expect(edgeFlow({ from: "a", to: "ghost" }, state)).toBe("idle");
  });
});

describe("summarizeDag", () => {
  it("按状态计数", () => {
    let state = createInitialDagState(["a", "b", "c"]);
    state = applyDagEvent(state, { type: "agent:start", agentId: "a", name: "A" }, 1);
    state = applyDagEvent(state, { type: "agent:done", agentId: "a", output: "x" }, 2);
    state = applyDagEvent(state, { type: "agent:start", agentId: "b", name: "B" }, 3);
    state = applyDagEvent(state, { type: "error", agentId: "c", message: "x" }, 4);
    expect(summarizeDag(state)).toEqual({
      total: 3,
      pending: 0,
      running: 1,
      completed: 1,
      failed: 1,
    });
  });
});
