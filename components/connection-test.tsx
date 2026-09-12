"use client";

import { useState } from "react";

type HealthResponse =
  | { ok: true; model: string; reply: string }
  | { ok: false; error: string };

type TestState = "idle" | "loading" | "ok" | "error";

export function ConnectionTest() {
  const [state, setState] = useState<TestState>("idle");
  const [message, setMessage] = useState("");

  async function run() {
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as HealthResponse;
      if (data.ok) {
        setState("ok");
        setMessage(`连接成功 · 模型 ${data.model} 回复：${data.reply}`);
      } else {
        setState("error");
        setMessage(data.error);
      }
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "网络错误");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        className="w-fit rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {state === "loading" ? "测试中…" : "测试模型连接"}
      </button>
      {state === "ok" && <p className="text-sm text-green-600">{message}</p>}
      {state === "error" && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}
