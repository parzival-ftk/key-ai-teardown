import { describe, it, expect } from "vitest";
import type { KVStore } from "@/lib/history";
import {
  createProject,
  ensureExampleProject,
  getProject,
  listProjects,
  projectStorageKey,
  removeProject,
  saveProject,
} from "./project-store";
import { EXAMPLE_PROJECT_ID, createExampleProject } from "./demo-project";
import { treeFromRaw } from "./tree";

function memStore(): KVStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const TREE = treeFromRaw({ name: "Page", children: [{ name: "Section" }] });

describe("项目持久化", () => {
  it("新建后可读回（刷新页面仍存在的等价保证）", () => {
    const store = memStore();
    const created = createProject(store, { name: "My Page", tree: TREE, id: "p1", now: 1000 });
    const loaded = getProject(store, "p1");
    expect(loaded).toEqual(created);
    expect(loaded?.tree.nodes.n1.name).toBe("Page");
  });

  it("listProjects 按 updatedAt 倒序", () => {
    const store = memStore();
    createProject(store, { name: "Old", tree: TREE, id: "a", now: 1000 });
    createProject(store, { name: "New", tree: TREE, id: "b", now: 2000 });
    expect(listProjects(store).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("saveProject 更新索引而不产生重复条目", () => {
    const store = memStore();
    const project = createProject(store, { name: "P", tree: TREE, id: "p1", now: 1000 });
    saveProject(store, { ...project, name: "P2", updatedAt: 1500 });
    const list = listProjects(store);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("P2");
  });

  it("removeProject 同时清掉索引与项目体", () => {
    const store = memStore();
    createProject(store, { name: "P", tree: TREE, id: "p1" });
    removeProject(store, "p1");
    expect(listProjects(store)).toHaveLength(0);
    expect(store.getItem(projectStorageKey("p1"))).toBeNull();
  });

  it("损坏的项目数据读回为 null 而不抛错", () => {
    const store = memStore();
    store.setItem(projectStorageKey("bad"), "{ not json");
    expect(getProject(store, "bad")).toBeNull();
    store.setItem(projectStorageKey("bad2"), JSON.stringify({ id: "bad2" }));
    expect(getProject(store, "bad2")).toBeNull();
  });
});

describe("示例工作区", () => {
  it("首次访问即安装示例项目", () => {
    const store = memStore();
    const project = ensureExampleProject(store, 5000);
    expect(project.id).toBe(EXAMPLE_PROJECT_ID);
    expect(getProject(store, EXAMPLE_PROJECT_ID)?.name).toBe("落地页示例");
    expect(listProjects(store).map((p) => p.id)).toContain(EXAMPLE_PROJECT_ID);
  });

  it("幂等：已存在时不覆盖用户的改动", () => {
    const store = memStore();
    const first = ensureExampleProject(store, 5000);
    saveProject(store, { ...first, name: "Renamed by user", updatedAt: 9000 });
    const second = ensureExampleProject(store, 10000);
    expect(second.name).toBe("Renamed by user");
  });

  it("示例树形：Landing Page → 4 个 section，Illustration 预置 prompt", () => {
    const project = createExampleProject(1000);
    const names = project.tree.nodes.n1.children.map((id) => project.tree.nodes[id].name);
    expect(names).toEqual(["页眉", "主视觉", "特性区", "页脚"]);

    const illustration = Object.values(project.tree.nodes).find(
      (node) => node.name === "插图",
    );
    expect(illustration?.prompt).toContain("cinematic");
    expect(illustration?.type).toBe("component");
  });

  it("示例节点都带可用的真实矩形（无需再布局）", () => {
    const project = createExampleProject(1000);
    for (const node of Object.values(project.tree.nodes)) {
      expect(node.rect.width).toBeGreaterThan(0);
      expect(node.rect.height).toBeGreaterThan(0);
    }
  });
});
