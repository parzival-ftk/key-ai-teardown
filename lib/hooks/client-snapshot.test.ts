import { describe, it, expect, vi } from "vitest";
import {
  createStorageStore,
  makeCachedJsonReader,
  makeCachedValue,
} from "./client-snapshot";

describe("makeCachedJsonReader", () => {
  it("同一 raw 反复调用返回同一引用（避免 useSyncExternalStore 无限重渲染）", () => {
    const read = makeCachedJsonReader<{ a: number }>(
      () => '{"a":1}',
      { a: 0 },
    );
    const first = read();
    const second = read();
    expect(first).toBe(second);
    expect(first).toEqual({ a: 1 });
  });

  it("raw 变化时更新缓存值（引用改变）", () => {
    let raw: string | null = '{"a":1}';
    const read = makeCachedJsonReader<{ a: number }>(() => raw, { a: 0 });
    const first = read();
    raw = '{"a":2}';
    const second = read();
    expect(first).not.toBe(second);
    expect(second).toEqual({ a: 2 });
  });

  it("raw 为 null → 返回 fallback（且引用稳定）", () => {
    const fallback = { a: -1 };
    const read = makeCachedJsonReader<{ a: number }>(() => null, fallback);
    expect(read()).toBe(fallback);
    expect(read()).toBe(read());
  });

  it("非法 JSON → 降级为 fallback", () => {
    const fallback = { a: -1 };
    const read = makeCachedJsonReader<{ a: number }>(() => "{坏", fallback);
    expect(read()).toBe(fallback);
  });
});

describe("makeCachedValue", () => {
  it("只求值一次并缓存引用", () => {
    const read = vi.fn(() => ({ v: 1 }));
    const cached = makeCachedValue(read);
    const a = cached();
    const b = cached();
    expect(a).toBe(b);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("createStorageStore", () => {
  it("notify 触发所有订阅者；退订后不再触发", () => {
    const raw: string | null = null;
    const store = createStorageStore<number[]>(() => raw, []);
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);

    store.notify();
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.notify();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("read 按 raw 缓存：变更前同一引用，变更后反映新值", () => {
    let raw: string | null = '{"x":1}';
    const store = createStorageStore<{ x: number }>(() => raw, { x: 0 });
    const a = store.read();
    expect(store.read()).toBe(a);
    raw = '{"x":2}';
    expect(store.read()).toEqual({ x: 2 });
  });
});
