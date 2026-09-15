"use client";

import { useMemo, useState } from "react";
import {
  ALL_CATEGORIES,
  countResources,
  filterResources,
  loadResourceDataset,
  type ResourceCategory,
  type ResourceCategoryId,
} from "@/lib/resources/ui-resources";

/**
 * UI 资源导航（W28）—— 把内置 UI 资源库变成**可交互工具**。
 *
 * 分类 Tabs + 关键字实时搜索 + 响应式卡片网格（单列 → 双列 → 三列）；
 * 卡片悬停上浮、暗色模式高亮边框，标签以 Badge 呈现；
 * 外链一律 `target="_blank" rel="noopener noreferrer"`（防 reverse tabnabbing）。
 *
 * 组件只接 props（数据集），筛选逻辑全在 `lib/resources/ui-resources` 的纯函数里，
 * 组件仅负责把结果放上屏 —— 与仓库既有的「引擎/视图分离」一致。
 */

export interface ResourceNavProps {
  /** 数据集；缺省用内置数据源（`ui-resources.json`） */
  dataset?: ResourceCategory[];
}

export function ResourceNav({ dataset }: ResourceNavProps) {
  const source = dataset ?? loadResourceDataset();
  const [category, setCategory] = useState<
    ResourceCategoryId | typeof ALL_CATEGORIES
  >(ALL_CATEGORIES);
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () => filterResources(source, { query, category }),
    [source, query, category],
  );

  const total = countResources(source);
  const shown = countResources(groups);

  const tabClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active
        ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black"
        : "border-gray-300 text-gray-600 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
    }`;

  return (
    <section data-resource-nav className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="资源分类" className="flex flex-wrap gap-2">
          <button
            type="button"
            data-resource-tab="all"
            aria-pressed={category === ALL_CATEGORIES}
            onClick={() => setCategory(ALL_CATEGORIES)}
            className={tabClass(category === ALL_CATEGORIES)}
          >
            全部 {total}
          </button>
          {source.map((group) => (
            <button
              key={group.category}
              type="button"
              data-resource-tab={group.category}
              aria-pressed={category === group.category}
              onClick={() => setCategory(group.category)}
              className={tabClass(category === group.category)}
            >
              {group.categoryName} {group.items.length}
            </button>
          ))}
        </div>

        <input
          type="search"
          data-resource-search
          aria-label="搜索 UI 资源"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称 / 标签 / 简介…"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500 sm:w-64 dark:border-gray-700 dark:bg-gray-950"
        />
      </div>

      <p data-resource-count className="text-xs text-gray-400">
        共 {shown} / {total} 个资源
      </p>

      {groups.length === 0 ? (
        <p
          data-resource-empty
          className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400 dark:border-gray-700"
        >
          没有匹配的资源，换个关键字试试。
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.category}
            data-resource-group={group.category}
            className="flex flex-col gap-2"
          >
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {group.categoryName}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <li
                  key={item.id}
                  data-resource-card={item.id}
                  className="rounded-xl border border-gray-200 transition hover:-translate-y-0.5 hover:border-gray-400 hover:shadow-lg dark:border-gray-800 dark:hover:border-gray-500"
                >
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-full flex-col gap-2 p-4"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {item.name}
                    </span>
                    <span className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {item.description}
                    </span>
                    <span className="mt-auto flex flex-wrap gap-1 pt-1">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          data-resource-tag
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span className="truncate text-[11px] text-gray-400">
                      {item.url}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
