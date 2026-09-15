import { describe, it, expect } from "vitest";
import {
  createDefaultAgents,
  DEFAULT_PARALLEL_AGENT_IDS,
} from "@/lib/agents/analysis-stream";
import {
  planLayers,
  resolveDependencies,
  transitiveReduction,
} from "@/lib/agents/dag";
import { DAG_CONFIG, DAG_EDGES, DAG_LAYERS, DAG_NODE_IDS } from "./dagConfig";
import { computeDagLayout, edgePath } from "./dag-layout";

/**
 * 防漂移测试：把静态 DAG 配置钉在**真实编队**上。
 * 编队增删 Agent、改 dependsOn 或并行组，这里立刻红 —— 拓扑图不会悄悄失真。
 */
describe("DAG_CONFIG 对照真实编队（防漂移）", () => {
  const agents = createDefaultAgents();
  const deps = resolveDependencies(agents, new Set(DEFAULT_PARALLEL_AGENT_IDS));
  const layers = planLayers(
    agents.map((a) => a.id),
    deps,
  );

  it("分层与真实编队一致（层内并行、层间串行）", () => {
    expect(DAG_LAYERS).toEqual(layers);
    expect(DAG_CONFIG.layerCount).toBe(layers.length);
  });

  it("节点 id / name / layer / dependsOn 逐项一致", () => {
    const layerOf = new Map<string, number>();
    layers.forEach((layer, index) =>
      layer.forEach((id) => layerOf.set(id, index)),
    );

    expect(DAG_CONFIG.nodes.map((n) => n.id).sort()).toEqual(
      agents.map((a) => a.id).sort(),
    );

    for (const node of DAG_CONFIG.nodes) {
      const agent = agents.find((a) => a.id === node.id);
      expect(agent, `编队缺少 Agent ${node.id}`).toBeDefined();
      expect(node.name).toBe(agent!.name);
      expect(node.layer).toBe(layerOf.get(node.id));
      expect(node.dependsOn).toEqual(deps.get(node.id));
    }
  });

  it("绘制边 = 真实依赖的传递归约（保留可达性、去冗余）", () => {
    const norm = (e: { from: string; to: string }) => `${e.from}->${e.to}`;
    expect(DAG_EDGES.map(norm).sort()).toEqual(
      transitiveReduction(deps).map(norm).sort(),
    );
  });

  it("每条绘制边都被目标节点的原始依赖包含（图与依赖不矛盾）", () => {
    for (const edge of DAG_EDGES) {
      const target = DAG_CONFIG.nodes.find((n) => n.id === edge.to);
      expect(target, `边的目标节点不存在：${edge.to}`).toBeDefined();
      expect(target!.dependsOn).toContain(edge.from);
    }
  });

  it("归约确实减少了边（31 条原始边 → 9 条骨干边）", () => {
    const rawCount = [...deps.values()].reduce((n, list) => n + list.length, 0);
    expect(DAG_EDGES.length).toBeLessThan(rawCount);
    expect(DAG_EDGES).toHaveLength(9);
  });
});

describe("computeDagLayout（纯布局数学）", () => {
  const layout = computeDagLayout(DAG_CONFIG);

  it("每个节点都有坐标，画布尺寸为正", () => {
    expect(Object.keys(layout.positions).sort()).toEqual(
      [...DAG_NODE_IDS].sort(),
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("同层节点 x 相同、y 严格递增（不重叠）", () => {
    const layer = DAG_LAYERS[0];
    expect(new Set(layer.map((id) => layout.positions[id].x)).size).toBe(1);
    const ys = layer.map((id) => layout.positions[id].y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(ys.length);
  });

  it("层间 x 严格递增", () => {
    const xOf = (index: number) => layout.positions[DAG_LAYERS[index][0]].x;
    for (let i = 1; i < DAG_LAYERS.length; i++) {
      expect(xOf(i)).toBeGreaterThan(xOf(i - 1));
    }
  });

  it("短层在行方向居中（图形对称）", () => {
    const first = layout.positions[DAG_LAYERS[1][0]];
    const last = layout.positions[DAG_LAYERS[0][0]];
    expect(first.y).toBeGreaterThan(last.y); // 单节点层在第一行之下
  });

  it("连线路径是合法三次贝塞尔", () => {
    const path = edgePath(
      layout.positions["user-research"],
      layout.positions["interviewer"],
    );
    expect(path.startsWith("M ")).toBe(true);
    expect(path).toContain(" C ");
  });
});
