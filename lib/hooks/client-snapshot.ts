"use client";

import { useSyncExternalStore } from "react";

/**
 * 「仅客户端存在」的值的安全读取（本次重构）。
 *
 * 背景：react-hooks v6 的 `set-state-in-effect` 会命中「挂载时读 sessionStorage /
 * localStorage / document 再 setState」这一模式；而改成 `useState` 惰性初始化会让
 * 服务端首帧与客户端不一致（hydration mismatch）。`useSyncExternalStore` 正是 React
 * 为「订阅外部存储」提供的原语：服务端渲染用 getServerSnapshot，客户端挂载后再切到
 * 真实快照，天然避免不一致。
 *
 * 纪律：getSnapshot 必须返回**稳定引用**（React 用 Object.is 比较，返回新对象会无限重渲染），
 * 故这里提供 makeCachedJsonReader / makeCachedValue 两个带缓存的读取器工厂。
 */

/** 空订阅：值在客户端生命周期内不变化，或只在本组件内变更 */
export const noopSubscribe = (): (() => void) => () => {};

/**
 * 把「读原始字符串」包成带内容缓存的快照读取器：
 * 同一 raw 反复调用返回**同一引用**；raw 变化或解析失败时更新缓存。
 */
export function makeCachedJsonReader<T>(
  readRaw: () => string | null,
  fallback: T,
): () => T {
  let cacheKey: string | null | undefined = undefined;
  let cache: T = fallback;
  return () => {
    const raw = readRaw();
    if (raw !== cacheKey) {
      cacheKey = raw;
      if (raw === null) {
        cache = fallback;
      } else {
        try {
          cache = JSON.parse(raw) as T;
        } catch {
          cache = fallback;
        }
      }
    }
    return cache;
  };
}

/** 只求值一次并缓存引用的读取器（用于「读一次 DOM / 环境事实」） */
export function makeCachedValue<T>(read: () => T): () => T {
  let computed = false;
  let cache: T;
  return () => {
    if (!computed) {
      cache = read();
      computed = true;
    }
    return cache;
  };
}

export interface ExternalStore<T> {
  read: () => T;
  subscribe: (onChange: () => void) => () => void;
  notify: () => void;
}

/** 通用外部存储：自定义 read（缓存责任在调用方，须返回稳定引用）+ 订阅/通知 */
export function createStore<T>(read: () => T): ExternalStore<T> {
  const listeners = new Set<() => void>();
  return {
    read,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Web Storage（JSON 值）的外部存储。
 * 变更需由写入方调用返回的 notify（见 HistoryList 的删除）。
 */
export function createStorageStore<T>(
  readRaw: () => string | null,
  fallback: T,
): ExternalStore<T> {
  return createStore(makeCachedJsonReader(readRaw, fallback));
}

/** 是否已完成客户端挂载（服务端 false / 客户端 true）—— 取代原先的 `loaded` 状态 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** 读取「仅客户端存在」的快照：SSR 用 serverSnapshot，客户端用 getSnapshot */
export function useClientSnapshot<T>(
  getSnapshot: () => T,
  serverSnapshot: T,
  subscribe: (onChange: () => void) => () => void = noopSubscribe,
): T {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}
