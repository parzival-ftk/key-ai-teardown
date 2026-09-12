"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InputSource, Mode, ProductBrief } from "@/lib/types/brief";

/**
 * 输入表单 —— 四类输入源（文本 / URL / 截图 / PDF）+ 双模式（拆解 / 共创）。
 *
 * URL 与 PDF 经 /api/parse 解析成正文文本（rawText）；
 * 截图经 /api/parse 校验后以 data URL 存入 brief，分析时交给多模态模型识别。
 * 提交后生成 analysisId，把 brief 存入 sessionStorage，跳转分析页。
 */

const SOURCES: { value: InputSource; label: string; hint: string }[] = [
  { value: "text", label: "文本", hint: "手动输入产品名与描述" },
  { value: "url", label: "URL", hint: "粘贴产品官网链接，自动抓取正文" },
  { value: "screenshot", label: "截图", hint: "上传产品截图，由多模态模型识别" },
  { value: "pdf", label: "PDF", hint: "上传 PDF（报告 / PRD），自动提取文本" },
];

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("文件读取失败，请重试"));
    reader.readAsDataURL(file);
  });
}

export function BriefForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("teardown");
  const [source, setSource] = useState<InputSource>("text");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSource = SOURCES.find((s) => s.value === source)!;

  /** 按输入源构造 brief（URL / PDF 解析为文本；截图校验并保留 data URL） */
  async function buildBrief(base: {
    name: string;
    description: string;
    mode: Mode;
  }): Promise<ProductBrief> {
    const post = async (payload: unknown) => {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        text?: string;
        dataUrl?: string;
        /** W8：无头渲染得到的 UI 结构（本机无浏览器时缺省） */
        uiStructure?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `解析失败：HTTP ${res.status}`);
      return data;
    };

    if (source === "url") {
      if (!url.trim()) throw new Error("请填写 URL");
      const data = await post({ type: "url", url: url.trim() });
      return {
        ...base,
        source: "url",
        rawText: data.text ?? "",
        sourceUrl: url.trim(),
        uiStructure: data.uiStructure ?? "",
      };
    }

    if (source === "screenshot") {
      if (!file) throw new Error("请选择截图文件");
      const dataUrl = await readAsDataUrl(file);
      const data = await post({ type: "screenshot", dataUrl });
      if (!data.dataUrl) throw new Error("截图解析未返回图片数据");
      return {
        ...base,
        source: "screenshot",
        rawText: "",
        screenshotDataUrl: data.dataUrl,
        uiStructure: "",
      };
    }

    if (source === "pdf") {
      if (!file) throw new Error("请选择 PDF 文件");
      // 传完整 data URL（含 application/pdf 前缀），由服务端 extractBase64 处理
      const dataUrl = await readAsDataUrl(file);
      const data = await post({ type: "pdf", dataBase64: dataUrl });
      return { ...base, source: "pdf", rawText: data.text ?? "", uiStructure: "" };
    }

    return { ...base, source: "text", rawText: "", uiStructure: "" };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    try {
      const brief = await buildBrief({
        name: trimmed,
        description: description.trim(),
        mode,
      });

      const id = crypto.randomUUID();
      try {
        sessionStorage.setItem(`brief:${id}`, JSON.stringify(brief));
      } catch {
        // sessionStorage 不可用时降级：分析页会提示重新提交
      }
      router.push(`/analyze/${id}`);
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

      <div className="flex flex-wrap gap-2">
        {SOURCES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              setSource(opt.value);
              setFile(null);
              setError(null);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              source === opt.value
                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black"
                : "border-gray-300 text-gray-600 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-xs text-gray-400">{activeSource.hint}</p>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          {mode === "teardown" ? "产品名称" : "想法名称"}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            mode === "teardown"
              ? "例如：Notion"
              : "例如：面向宠物主人的订阅制零食盒"
          }
          className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 outline-none focus:border-gray-900 dark:border-gray-700 dark:focus:border-gray-100"
        />
      </label>

      {source === "url" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">产品链接</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="rounded-lg border border-gray-300 bg-transparent px-3 py-2 outline-none focus:border-gray-900 dark:border-gray-700 dark:focus:border-gray-100"
          />
        </label>
      )}

      {source === "screenshot" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">产品截图</span>
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-gray-800"
          />
        </label>
      )}

      {source === "pdf" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">PDF 文件</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-gray-800"
          />
        </label>
      )}

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

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="w-fit rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {busy
          ? "解析中…"
          : mode === "teardown"
            ? "开始拆解"
            : "开始共创"}
      </button>
    </form>
  );
}
