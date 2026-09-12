"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_COMPARE_PRODUCTS, MIN_COMPARE_PRODUCTS } from "@/lib/types/compare";

/**
 * 对比输入表单（W11）—— 收集 2-3 个产品（名称 + 可选描述）。
 * 提交后把 CompareBrief 存入 sessionStorage，跳转 /compare/[id]。
 * 相比单产品表单，这里只支持文本输入：对比场景要的是「同类产品横向比」，
 * URL / 截图 / PDF 的多产品解析会显著拉长首屏等待，暂不做（见 Roadmap 留债）。
 */

interface Draft {
  name: string;
  description: string;
}

const emptyDraft = (): Draft => ({ name: "", description: "" });

export function CompareForm() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft(), emptyDraft()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );

  const addProduct = () =>
    setDrafts((prev) =>
      prev.length < MAX_COMPARE_PRODUCTS ? [...prev, emptyDraft()] : prev,
    );

  const removeProduct = (index: number) =>
    setDrafts((prev) =>
      prev.length > MIN_COMPARE_PRODUCTS
        ? prev.filter((_, i) => i !== index)
        : prev,
    );

  const canSubmit =
    drafts.length >= MIN_COMPARE_PRODUCTS &&
    drafts.every((d) => d.name.trim() !== "") &&
    !busy;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      const compareBrief = {
        products: drafts.map((d) => ({
          name: d.name.trim(),
          description: d.description.trim(),
        })),
      };
      const id = crypto.randomUUID();
      try {
        sessionStorage.setItem(`compare:${id}`, JSON.stringify(compareBrief));
      } catch {
        // sessionStorage 不可用时降级：对比页会提示重新提交
      }
      router.push(`/compare/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请重试");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 p-5 dark:border-gray-800"
    >
      {drafts.map((draft, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">产品 {i + 1}</span>
            {drafts.length > MIN_COMPARE_PRODUCTS && (
              <button
                type="button"
                onClick={() => removeProduct(i)}
                className="text-xs text-gray-400 hover:text-red-500 hover:underline"
              >
                移除
              </button>
            )}
          </div>
          <input
            value={draft.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="产品名称，例如：Notion"
            className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:focus:border-gray-100"
          />
          <textarea
            value={draft.description}
            onChange={(e) => update(i, { description: e.target.value })}
            rows={2}
            placeholder="一句话定位或主要功能（可选）"
            className="resize-y rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:focus:border-gray-100"
          />
        </div>
      ))}

      <div className="flex items-center gap-3">
        {drafts.length < MAX_COMPARE_PRODUCTS && (
          <button
            type="button"
            onClick={addProduct}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-gray-500 dark:border-gray-700 dark:text-gray-200"
          >
            + 增加产品（最多 {MAX_COMPARE_PRODUCTS} 个）
          </button>
        )}
        <span className="text-xs text-gray-400">
          当前 {drafts.length} 个产品（{MIN_COMPARE_PRODUCTS}-{MAX_COMPARE_PRODUCTS} 个）
        </span>
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-fit rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {busy ? "跳转中…" : "开始对比"}
      </button>
    </form>
  );
}
