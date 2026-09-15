import { describe, it, expect } from "vitest";
import {
  planLayers,
  resolveDependencies,
  transitiveReduction,
} from "./dag";
import type { Agent } from "@/lib/types/agent";

function agent(id: string, dependsOn?: string[]): Agent {
  return {
    id,
    name: id,
    description: "",
    dependsOn,
    async run() {
      return { agentId: id, output: "", evidence: [], failed: false };
    },
  };
}

describe("resolveDependencies", () => {
  it("并行组视为无依赖；串行 Agent 依赖其之前声明的全部 Agent", () => {
    const deps = resolveDependencies(
      [agent("a"), agent("b"), agent("c")],
      new Set(["a", "b"]),
    );
    expect(deps.get("a")).toEqual([]);
    expect(deps.get("b")).toEqual([]);
    expect(deps.get("c")).toEqual(["a", "b"]);
  });

  it("显式 dependsOn 优先（收窄上下文）", () => {
    const deps = resolveDependencies(
      [agent("a"), agent("b"), agent("c", ["a"])],
      new Set(["a", "b"]),
    );
    expect(deps.get("c")).toEqual(["a"]);
  });

  it("依赖不存在的 Agent → 抛错（fail-closed）", () => {
    expect(() =>
      resolveDependencies([agent("a", ["ghost"])], new Set()),
    ).toThrow(/不存在的 Agent/);
  });
});

describe("planLayers", () => {
  it("并行组同层，串行 Agent 依次成层", () => {
    const agents = [agent("a"), agent("b"), agent("c")];
    const deps = resolveDependencies(agents, new Set(["a", "b"]));
    expect(planLayers(agents.map((a) => a.id), deps)).toEqual([["a", "b"], ["c"]]);
  });

  it("链式串行各占一层（依赖「全部前序」的语义）", () => {
    const agents = [agent("a"), agent("b"), agent("c"), agent("d")];
    const deps = resolveDependencies(agents, new Set(["a"]));
    expect(planLayers(agents.map((a) => a.id), deps)).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("依赖环 → 抛错（不挂起）", () => {
    const agents = [agent("a", ["b"]), agent("b", ["a"])];
    const deps = resolveDependencies(agents, new Set());
    expect(() => planLayers(agents.map((a) => a.id), deps)).toThrow(/无法推进|依赖环/);
  });
});

describe("transitiveReduction", () => {
  it("链式冗余边被去掉（a→c 经 a→b→c 可达）", () => {
    const deps = new Map<string, string[]>([
      ["a", []],
      ["b", ["a"]],
      ["c", ["a", "b"]],
    ]);
    expect(transitiveReduction(deps)).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
  });

  it("无替代路径的扇入边全部保留", () => {
    const deps = new Map<string, string[]>([
      ["a", []],
      ["b", []],
      ["d", ["a", "b"]],
    ]);
    const edges = transitiveReduction(deps);
    expect(edges).toHaveLength(2);
    expect(edges).toEqual(
      expect.arrayContaining([
        { from: "a", to: "d" },
        { from: "b", to: "d" },
      ]),
    );
  });

  it("归约不改变可达性", () => {
    const deps = new Map<string, string[]>([
      ["a", []],
      ["b", ["a"]],
      ["c", ["a", "b"]],
      ["d", ["a", "b", "c"]],
    ]);
    const edges = transitiveReduction(deps);
    // 边方向是 dep → dependent，故「某节点的祖先」要沿边**反向**回溯
    const ancestors = (id: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const e of edges) {
          if (e.to === cur && !seen.has(e.from)) {
            seen.add(e.from);
            stack.push(e.from);
          }
        }
      }
      return seen;
    };
    // 原始依赖里的每一条祖先关系，归约后仍可达
    for (const [id, list] of deps) {
      const reachable = ancestors(id);
      for (const dep of list) expect(reachable.has(dep)).toBe(true);
    }
    // 且归约后的边数严格少于原始边数（确有冗余被去除）
    const rawCount = [...deps.values()].reduce((n, l) => n + l.length, 0);
    expect(edges.length).toBeLessThan(rawCount);
  });
});
