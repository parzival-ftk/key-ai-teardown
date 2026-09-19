import { describe, it, expect } from "vitest";
import {
  parseAnalysisResponse,
  parseComponentTree,
  parseProject,
} from "./schema";
import type { ComponentTree, Project } from "./types";

const AI_JSON = {
  page: {
    name: "Landing Page",
    children: [
      { type: "section", name: "Header" },
      {
        type: "section",
        name: "Hero",
        children: [
          {
            type: "component",
            name: "SearchBox",
            properties: { text: "Search" },
          },
        ],
      },
    ],
  },
};

describe("parseAnalysisResponse", () => {
  it("合法嵌套 JSON 归一成扁平树", () => {
    const result = parseAnalysisResponse(AI_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree.rootId).toBe("n1");
    expect(result.tree.nodes.n4.name).toBe("SearchBox");
    expect(result.tree.nodes.n4.properties).toEqual({ text: "Search" });
    expect(result.tree.nodes.n2.type).toBe("section");
  });

  it("缺 page 字段 → 失败并给出可读错误", () => {
    const result = parseAnalysisResponse({ root: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("name 为空 → 失败（不接受无名组件）", () => {
    const result = parseAnalysisResponse({ page: { name: "" } });
    expect(result.ok).toBe(false);
  });

  it("非对象输入 → 失败而不抛错", () => {
    expect(parseAnalysisResponse(null).ok).toBe(false);
    expect(parseAnalysisResponse("nope").ok).toBe(false);
  });
});

describe("parseComponentTree / parseProject", () => {
  const tree: ComponentTree = { rootId: "n1", nodes: { n1: { id: "n1", type: "page", name: "P", rect: { x: 0, y: 0, width: 10, height: 10 }, children: [] } } };

  it("合法扁平树通过校验", () => {
    expect(parseComponentTree(tree)?.rootId).toBe("n1");
  });

  it("非法输入返回 null", () => {
    expect(parseComponentTree(42)).toBeNull();
    expect(parseComponentTree({ rootId: "n1" })).toBeNull();
  });

  it("项目对象可 JSON 往返（持久化契约）", () => {
    const project: Project = {
      id: "p1",
      name: "Landing Page",
      source: "example",
      createdAt: 1,
      updatedAt: 2,
      tree,
      assets: [
        {
          id: "a1",
          componentId: "n1",
          provider: "comfyui",
          prompt: "x",
          artifactPath: "/tmp/a.png",
          width: 512,
          height: 512,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const roundTripped = parseProject(JSON.parse(JSON.stringify(project)));
    expect(roundTripped).toEqual(project);
  });

  it("损坏的项目对象返回 null", () => {
    expect(parseProject({ id: "p1" })).toBeNull();
    expect(parseProject(null)).toBeNull();
  });
});
