"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { EXAMPLE_PROJECT_ID } from "@/lib/components/demo-project";
import {
  PROJECT_INDEX_STORAGE_KEY,
  browserProjectStore,
  createProject,
  ensureExampleProject,
  listProjects,
  removeProject,
  type ProjectSummary,
} from "@/lib/components/project-store";
import { createStarterTree } from "@/lib/components/starter-project";
import { createStore, useClientSnapshot, useIsHydrated } from "@/lib/hooks/client-snapshot";

/**
 * 首页（阶段 15，spec §17/§18）。
 *
 * 只体现三件事：Create Project / Recent Projects / Example Project。
 * 产品核心界面是画布，不是 Dashboard —— 因此这里刻意保持轻。
 *
 * 列表来自 localStorage：经 `useSyncExternalStore` 订阅（而非「挂载时 setState」），
 * 服务端渲染空列表、客户端挂载后切到真实值 —— 避免 hydration mismatch 与
 * `react-hooks/set-state-in-effect`（沿用 `lib\hooks\client-snapshot` 的既有纪律）。
 */

const EMPTY: ProjectSummary[] = [];

/** 项目索引快照：按 raw 内容缓存，保证同一 raw 返回同一引用（useSyncExternalStore 契约） */
function makeProjectsSnapshot(): () => ProjectSummary[] {
  let cacheKey: string | null | undefined = undefined;
  let cache: ProjectSummary[] = EMPTY;
  return () => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PROJECT_INDEX_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw !== cacheKey) {
      cacheKey = raw;
      try {
        cache = listProjects(localStorage);
      } catch {
        cache = EMPTY;
      }
    }
    return cache;
  };
}

const projectsStore = createStore(makeProjectsSnapshot());

const SOURCE_LABEL: Record<ProjectSummary["source"], string> = {
  example: "示例",
  upload: "截图分析",
  blank: "空白",
};

export function HomeView() {
  const router = useRouter();
  const projects = useClientSnapshot(projectsStore.read, EMPTY, projectsStore.subscribe);
  const hydrated = useIsHydrated();

  /* 首次访问时安装示例工作区，让用户无需上传即可体验核心闭环（写外部存储后通知订阅者） */
  useEffect(() => {
    const store = browserProjectStore();
    if (!store) return;
    ensureExampleProject(store);
    projectsStore.notify();
  }, []);

  const createNew = () => {
    const store = browserProjectStore();
    if (!store) return;
    const project = createProject(store, {
      name: "未命名项目",
      tree: createStarterTree(),
      source: "blank",
    });
    router.push(`/project/${project.id}`);
  };

  const openExample = () => {
    const store = browserProjectStore();
    if (store) ensureExampleProject(store);
    router.push(`/project/${EXAMPLE_PROJECT_ID}`);
  };

  const remove = (id: string) => {
    const store = browserProjectStore();
    if (!store) return;
    removeProject(store, id);
    projectsStore.notify();
  };

  return (
    <main data-home className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Key</h1>
        <p className="text-sm text-gray-500">
          把产品界面截图拆解成结构化组件树，在无限画布上组织、检查，并通过 ComfyUI 生成视觉资产。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-home-create
            onClick={createNew}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            新建项目
          </button>
          <button
            type="button"
            data-home-example
            onClick={openExample}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            示例项目
          </button>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">最近项目</h2>
        {!hydrated ? (
          <p className="text-xs text-gray-400">加载中…</p>
        ) : projects.length === 0 ? (
          <p data-home-empty className="text-xs text-gray-400">
            还没有项目。点「新建项目」新建，或打开「示例项目」。
          </p>
        ) : (
          <ul data-home-projects className="flex flex-col gap-1">
            {projects.map((project) => (
              <li
                key={project.id}
                data-home-project={project.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
              >
                <Link
                  href={`/project/${project.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {project.name}
                </Link>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {SOURCE_LABEL[project.source]}
                </span>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {new Date(project.updatedAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  data-home-delete={project.id}
                  onClick={() => remove(project.id)}
                  className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:text-red-500 dark:border-gray-700"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
