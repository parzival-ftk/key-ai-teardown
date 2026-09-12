/**
 * 本地历史记录（Wave 5.6）—— 用 localStorage 持久化历次拆解报告。
 *
 * 通过 KVStore 抽象注入存储：浏览器传 localStorage，单测传内存实现，
 * 逻辑本身不依赖 window，便于纯函数测试。
 */

export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HistoryEntry {
  id: string;
  name: string;
  createdAt: number;
}

const INDEX_KEY = "key:history";
const REPORT_PREFIX = "key:report:";
const MAX_ENTRIES = 50;

export const reportStorageKey = (id: string) => `${REPORT_PREFIX}${id}`;

function readIndex(store: KVStore): HistoryEntry[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        !!e &&
        typeof (e as HistoryEntry).id === "string" &&
        typeof (e as HistoryEntry).name === "string" &&
        typeof (e as HistoryEntry).createdAt === "number",
    );
  } catch {
    return [];
  }
}

function writeIndex(store: KVStore, entries: HistoryEntry[]): void {
  store.setItem(INDEX_KEY, JSON.stringify(entries));
}

/** 列出历史（按时间倒序） */
export function listHistory(store: KVStore): HistoryEntry[] {
  return readIndex(store)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 保存一份报告并写入索引；超上限时裁剪最旧条目（含报告体）。返回更新后的索引。 */
export function saveReport(
  store: KVStore,
  meta: { id: string; name: string },
  report: unknown,
  now: number = Date.now(),
): HistoryEntry[] {
  store.setItem(reportStorageKey(meta.id), JSON.stringify(report));

  const entries = readIndex(store).filter((e) => e.id !== meta.id);
  entries.push({ id: meta.id, name: meta.name, createdAt: now });
  entries.sort((a, b) => b.createdAt - a.createdAt);

  for (const dropped of entries.slice(MAX_ENTRIES)) {
    store.removeItem(reportStorageKey(dropped.id));
  }
  const trimmed = entries.slice(0, MAX_ENTRIES);
  writeIndex(store, trimmed);
  return trimmed;
}

/** 读取某份报告；不存在或损坏返回 null */
export function getReport<T = unknown>(store: KVStore, id: string): T | null {
  try {
    const raw = store.getItem(reportStorageKey(id));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 删除一条历史（含报告体）；返回更新后的索引 */
export function removeReport(store: KVStore, id: string): HistoryEntry[] {
  store.removeItem(reportStorageKey(id));
  const entries = readIndex(store).filter((e) => e.id !== id);
  writeIndex(store, entries);
  return entries;
}
