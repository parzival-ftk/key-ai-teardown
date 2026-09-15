import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DAGTopologyView } from "./DAGTopologyView";
import { NodeInspector } from "./NodeInspector";
import {
  DAG_CONFIG,
  DAG_NODE_BY_ID,
  DAG_NODE_IDS,
} from "@/lib/orchestration/dagConfig";
import {
  applyDagEvent,
  createInitialDagState,
  type DagState,
} from "@/lib/orchestration/dag-state";

const count = (html: string, needle: string) =>
  (html.match(new RegExp(needle, "g")) ?? []).length;

function renderTopology(state: DagState, now = 1000): string {
  return renderToStaticMarkup(
    <DAGTopologyView
      state={state}
      now={now}
      briefName="Notion"
      briefDescription="协作文档工具"
    />,
  );
}

const started = (state: DagState, id: string, now = 1) =>
  applyDagEvent(state, { type: "agent:start", agentId: id, name: id }, now);
const finished = (state: DagState, id: string, output: string, now = 2) =>
  applyDagEvent(state, { type: "agent:done", agentId: id, output }, now);

describe("DAGTopologyView（服务端静态渲染）", () => {
  it("渲染全部节点、层数说明与层标签", () => {
    const html = renderTopology(createInitialDagState(DAG_NODE_IDS));
    for (const id of DAG_NODE_IDS) {
      expect(html, `缺少节点 ${id}`).toContain(`data-dag-node="${id}"`);
    }
    expect(count(html, "data-dag-node=")).toBe(DAG_CONFIG.nodes.length);
    expect(html).toContain(
      `流水线拓扑（${DAG_CONFIG.layerCount} 层 · ${DAG_CONFIG.nodes.length} 个 Agent）`,
    );
    expect(html).toContain("并行分析");
    expect(html).toContain("PRD");
  });

  it("渲染全部边，初始全为 idle", () => {
    const html = renderTopology(createInitialDagState(DAG_NODE_IDS));
    expect(count(html, "data-dag-edge=")).toBe(DAG_CONFIG.edges.length);
    expect(count(html, 'data-dag-flow="idle"')).toBe(DAG_CONFIG.edges.length);
    expect(html).toContain("<svg");
  });

  it("父完成 + 子运行中 → 该边标记 flowing 并挂流动光效类", () => {
    let state = createInitialDagState(DAG_NODE_IDS);
    state = finished(state, "user-research", "画像");
    state = started(state, "interviewer", 3);
    const html = renderTopology(state, 3000);

    expect(count(html, 'data-dag-flow="flowing"')).toBe(1);
    expect(html).toContain("dag-edge-flow");
    expect(html).toContain('data-dag-status="running"');
    expect(html).toContain("已完成 1/10");
    expect(html).toContain("进行中 1");
  });

  it("节点展示字符数与耗时", () => {
    let state = createInitialDagState(DAG_NODE_IDS);
    state = started(state, "market", 1000);
    state = applyDagEvent(
      state,
      { type: "agent:token", agentId: "market", delta: "一二三" },
      1100,
    );
    const html = renderTopology(state, 2500);
    expect(html).toContain("3 字符");
    expect(html).toContain("1.5s");
  });

  it("失败节点渲染为 failed 状态", () => {
    let state = createInitialDagState(DAG_NODE_IDS);
    state = started(state, "market");
    state = applyDagEvent(state, { type: "error", agentId: "market", message: "boom" }, 5);
    const html = renderTopology(state);
    expect(html).toContain('data-dag-status="failed"');
    expect(html).toContain("失败 1");
  });
});

describe("NodeInspector（内容渲染）", () => {
  const node = DAG_NODE_BY_ID["devils-advocate"];

  it("展示 Prompt 简报、输入依赖（翻成展示名）与本次输入", () => {
    const html = renderToStaticMarkup(
      <NodeInspector
        node={node}
        state={undefined}
        nodesById={DAG_NODE_BY_ID}
        briefName="Notion"
        briefDescription="协作文档工具"
        now={0}
        onClose={() => {}}
      />,
    );
    expect(html).toContain(node.brief);
    expect(html).toContain(`输入依赖（${node.dependsOn.length}）`);
    expect(html).toContain("竞品分析师"); // 依赖被翻成展示名
    expect(html).toContain("Notion");
    expect(html).toContain("（尚未开始）");
  });

  it("运行中展示流式产出与耗时", () => {
    let state = createInitialDagState(DAG_NODE_IDS);
    state = started(state, "devils-advocate", 1000);
    state = applyDagEvent(
      state,
      { type: "agent:token", agentId: "devils-advocate", delta: "被质疑的假设…" },
      1200,
    );
    const html = renderToStaticMarkup(
      <NodeInspector
        node={node}
        state={state["devils-advocate"]}
        nodesById={DAG_NODE_BY_ID}
        now={2600}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("被质疑的假设…");
    expect(html).toContain("1.6s");
    expect(html).toContain('data-dag-inspector-status="running"');
  });

  it("并行起始节点显示「无依赖」", () => {
    const html = renderToStaticMarkup(
      <NodeInspector
        node={DAG_NODE_BY_ID["market"]}
        state={undefined}
        nodesById={DAG_NODE_BY_ID}
        now={0}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("无 —— 并行起始节点");
  });
});
