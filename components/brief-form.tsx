"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Mode } from "@/lib/types/brief";

/**
 * 输入表单 —— 文本输入 + 双模式（拆解 / 共创）。
 * 提交后生成 analysisId，把 brief 存入 sessionStorage，跳转分析页。
 */
export function BriefForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>("teardown");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const id = crypto.randomUUID();
    const brief = {
      name: trimmed,
      description: description.trim(),
      mode,
      source: "text",
      rawText: "",
    };
    try {
      sessionStorage.setItem(`brief:${id}`, JSON.stringify(brief));
    } catch {
      // sessionStorage 不可用时降级：分析页会提示重新提交
    }
    router.push(`/analyze/${id}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 p-5 dark:border-gray-800"
    >
      <div className="flex gap-2">
        {(
          [
            { value: "teardown", label: "拆解产品" },
            { value: "co-create", label: "共创想法" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              mode === opt.value
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          {mode === "teardown" ? "产品名称" : "想法名称"}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            mode === "teardown" ? "例如：Notion" : "例如：面向宠物主人的订阅制零食盒"
          }
          autoFocus
          className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 outline-none focus:border-gray-900 dark:border-gray-700 dark:focus:border-gray-100"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          {mode === "teardown" ? "产品描述（可选）" : "想法描述（可选）"}
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="补一句它的定位或主要功能，分析会更准"
          className="resize-y rounded-lg border border-gray-300 bg-transparent px-3 py-2 outline-none focus:border-gray-900 dark:border-gray-700 dark:focus:border-gray-100"
        />
      </label>

      <button
        type="submit"
        disabled={!name.trim()}
        className="w-fit rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {mode === "teardown" ? "开始拆解" : "开始共创"}
      </button>
    </form>
  );
}
