import type { KVStore } from "@/lib/history";
import type { CapabilitySource, ComponentTree, Project, ProjectSource } from "./types";
import { parseProject } from "./schema";
import { EXAMPLE_PROJECT_ID, createExampleProject } from "./demo-project";

/**
 * 项目持久化（阶段 15，spec §19）。
 *
 * MVP 不引入数据库 / 服务端存储：沿用项目既有的 `KVStore` 抽象（`lib\history.ts`），
 * 浏览器传 localStorage，单测传内存实现。满足「刷新页面 → 项目仍存在」即可。
 *
 * 布局与 `lib\history` 一致：一个索引键（列表）+ 每个项目一个独立键（详情），
 * 读回时用 `parseProject` 校验，损坏数据一律当作不存在，绝不让脏数据进 UI。
 */

export interface ProjectSummary {
  id: string;
  name: string;
  source: ProjectSource;
  createdAt: number;
  updatedAt: number;
}

const INDEX_KEY = "key:projects";
const PROJECT_PREFIX = "key:project:";
const MAX_PROJECTS = 50;

/** 项目索引在 localStorage 中的键（供 useSyncExternalStore 快照读取） */
export const PROJECT_INDEX_STORAGE_KEY = INDEX_KEY;

export const projectStorageKey = (id: string) => `${PROJECT_PREFIX}${id}`;

/** 生成项目 id（时间戳 + 随机后缀，冲突概率可忽略；测试可注入） */
export function createProjectId(
  now: number = Date.now(),
  rand: () => number = Math.random,
): string {
  return `p-${now.toString(36)}-${Math.floor(rand() * 1e6).toString(36)}`;
}

function readIndex(store: KVStore): ProjectSummary[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ProjectSummary =>
        !!entry &&
        typeof (entry as ProjectSummary).id === "string" &&
        typeof (entry as ProjectSummary).name === "string" &&
        typeof (entry as ProjectSummary).createdAt === "number" &&
        typeof (entry as ProjectSummary).updatedAt === "number",
    );
  } catch {
    return [];
  }
}

function writeIndex(store: KVStore, entries: ProjectSummary[]): void {
  store.setItem(INDEX_KEY, JSON.stringify(entries));
}

function summaryOf(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    source: project.source,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** 列出项目摘要（最近更新在前） */
export function listProjects(store: KVStore): ProjectSummary[] {
  return readIndex(store)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 读取完整项目；不存在或损坏返回 null */
export function getProject(store: KVStore, id: string): Project | null {
  try {
    const raw = store.getItem(projectStorageKey(id));
    if (!raw) return null;
    return parseProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 保存项目并 upsert 索引；超上限时裁剪最旧条目（含项目体）。返回更新后的索引。 */
export function saveProject(store: KVStore, project: Project): ProjectSummary[] {
  store.setItem(projectStorageKey(project.id), JSON.stringify(project));

  const entries = readIndex(store).filter((entry) => entry.id !== project.id);
  entries.push(summaryOf(project));
  entries.sort((a, b) => b.updatedAt - a.updatedAt);

  for (const dropped of entries.slice(MAX_PROJECTS)) {
    store.removeItem(projectStorageKey(dropped.id));
  }
  const trimmed = entries.slice(0, MAX_PROJECTS);
  writeIndex(store, trimmed);
  return trimmed;
}

/** 删除项目（含项目体）；返回更新后的索引 */
export function removeProject(store: KVStore, id: string): ProjectSummary[] {
  store.removeItem(projectStorageKey(id));
  const entries = readIndex(store).filter((entry) => entry.id !== id);
  writeIndex(store, entries);
  return entries;
}

export interface CreateProjectInput {
  name: string;
  tree: ComponentTree;
  source?: ProjectSource;
  imageDataUrl?: string;
  analysisSource?: CapabilitySource;
  id?: string;
  now?: number;
}

/** 新建并落盘一个项目 */
export function createProject(store: KVStore, input: CreateProjectInput): Project {
  const now = input.now ?? Date.now();
  const project: Project = {
    id: input.id ?? createProjectId(now),
    name: input.name,
    source: input.source ?? "upload",
    createdAt: now,
    updatedAt: now,
    tree: input.tree,
    assets: [],
    ...(input.imageDataUrl ? { imageDataUrl: input.imageDataUrl } : {}),
    ...(input.analysisSource ? { analysisSource: input.analysisSource } : {}),
  };
  saveProject(store, project);
  return project;
}

/**
 * 确保示例项目存在并返回它（幂等）。
 *
 * 若已存在用户改动过的版本，**不覆盖** —— 示例工作区是用户可编辑的真实项目，
 * 不是每次进页面都重置的演示。
 */
export function ensureExampleProject(store: KVStore, now: number = Date.now()): Project {
  const existing = getProject(store, EXAMPLE_PROJECT_ID);
  if (existing) return existing;
  const project = createExampleProject(now);
  saveProject(store, project);
  return project;
}

/** 浏览器 localStorage 版 KVStore；非浏览器环境返回 null */
export function browserProjectStore(): KVStore | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
}
