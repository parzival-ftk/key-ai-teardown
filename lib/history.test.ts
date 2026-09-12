import { describe, it, expect } from "vitest";
import {
  listHistory,
  saveReport,
  getReport,
  removeReport,
  reportStorageKey,
  type KVStore,
} from "./history";

function memoryStore(): KVStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("本地历史记录（Wave 5.6）", () => {
  it("保存后可读回报告，并按时间倒序列出", () => {
    const store = memoryStore();
    saveReport(store, { id: "a", name: "Notion" }, { name: "Notion" }, 1000);
    saveReport(store, { id: "b", name: "Figma" }, { name: "Figma" }, 2000);

    const list = listHistory(store);
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    expect(getReport<{ name: string }>(store, "a")?.name).toBe("Notion");
  });

  it("同 id 重复保存只更新不重复", () => {
    const store = memoryStore();
    saveReport(store, { id: "a", name: "旧名" }, { v: 1 }, 1000);
    saveReport(store, { id: "a", name: "新名" }, { v: 2 }, 3000);

    const list = listHistory(store);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("新名");
    expect(getReport<{ v: number }>(store, "a")?.v).toBe(2);
  });

  it("removeReport 删除报告体与索引项", () => {
    const store = memoryStore();
    saveReport(store, { id: "a", name: "X" }, { v: 1 }, 1000);
    const list = removeReport(store, "a");
    expect(list).toHaveLength(0);
    expect(getReport(store, "a")).toBeNull();
    expect(store.getItem(reportStorageKey("a"))).toBeNull();
  });

  it("超过上限时裁剪最旧条目及其报告体", () => {
    const store = memoryStore();
    for (let i = 0; i < 55; i++) {
      saveReport(store, { id: `id-${i}`, name: `n${i}` }, { i }, i);
    }
    const list = listHistory(store);
    expect(list).toHaveLength(50);
    // 最旧的 5 个（id-0..id-4）应被裁掉
    expect(getReport(store, "id-0")).toBeNull();
    expect(getReport(store, "id-54")).not.toBeNull();
  });

  it("索引损坏时安全降级为空列表", () => {
    const store = memoryStore();
    store.setItem("key:history", "{不是 json");
    expect(listHistory(store)).toEqual([]);
  });

  it("报告体损坏时 getReport 返回 null", () => {
    const store = memoryStore();
    store.setItem(reportStorageKey("x"), "broken");
    expect(getReport(store, "x")).toBeNull();
  });

  it("保存时记录证据计数，可随列表读回（W2）", () => {
    const store = memoryStore();
    saveReport(
      store,
      {
        id: "a",
        name: "Notion",
        evidenceStats: { verified: 2, inferred: 1, missing: 0 },
      },
      { v: 1 },
      1000,
    );
    expect(listHistory(store)[0].evidenceStats).toEqual({
      verified: 2,
      inferred: 1,
      missing: 0,
    });
  });

  it("未提供证据计数时字段缺省（向后兼容旧条目）", () => {
    const store = memoryStore();
    saveReport(store, { id: "a", name: "X" }, { v: 1 }, 1000);
    expect(listHistory(store)[0].evidenceStats).toBeUndefined();
  });
});
