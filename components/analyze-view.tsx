"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { deserializeAgentEvent, type AgentEvent } from "@/lib/types/events";

type AgentStatus = "running" | "done" | "error";

interface AgentState {
  agentId: string;
  name: string;
  status: AgentStatus;
  output: string;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  running: "分析中",
  done: "已完成",
  error: "失败",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  running: "bg-blue-500 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
};

export function AnalyzeView({ id }: { id: string }) {
  const [briefName, setBriefName] = useState("");
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(`brief:${id}`);
    } catch {
      raw = null;
    }
    if (!raw) {
      setError("找不到本次分析的输入，请返回首页重新提交。");
      return;
    }

    let brief: { name?: string };
    try {
      brief = JSON.parse(raw);
    } catch {
      setError("输入数据已损坏，请返回首页重新提交。");
      return;
    }
    setBriefName(brief.name ?? "");

    const current: AgentState[] = [];
    const applyEvent = (event: AgentEvent) => {
      switch (event.type) {
        case "agent:start":
          current.push({
            agentId: event.agentId,
            name: event.name,
            status: "running",
            output: "",
          });
          break;
        case "agent:token": {
          const a = current.find((x) => x.agentId === event.agentId);
          if (a) a.output += event.delta;
          break;
        }
        case "agent:done": {
          const a = current.find((x) => x.agentId === event.agentId);
          if (a) {
            a.status = "done";
            if (event.output) a.output = event.output;
          }
          break;
        }
        case "error": {
          if (event.agentId) {
            const a = current.find((x) => x.agentId === event.agentId);
            if (a) a.status = "error";
            else
              current.push({
                agentId: event.agentId,
                name: event.agentId,
                status: "error",
                output: "",
              });
          } else {
            setError(event.message);
          }
          break;
        }
        case "done":
          setFinished(true);
          break;
      }
      setAgents([...current]);
    };

    (async () => {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!cancelled) setError(data.error ?? `请求失败：HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = deserializeAgentEvent(line);
          if (event && !cancelled) applyEvent(event);
        }
      }

      // 落盘报告供报告页读取
      try {
        sessionStorage.setItem(
          `report:${id}`,
          JSON.stringify({ name: brief.name, sections: current }),
        );
      } catch {
        // 忽略存储失败
      }
    })().catch((err) => {
      if (!cancelled)
        setError(err instanceof Error ? err.message : "未知错误");
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回
        </Link>
        <h1 className="text-2xl font-bold">
          {briefName ? `正在分析：${briefName}` : "正在启动分析流水线…"}
        </h1>
      </header>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {agents.map((agent) => (
          <section
            key={agent.agentId}
            className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status]}`}
              />
              <h2 className="font-medium">{agent.name}</h2>
              <span className="text-xs text-gray-400">
                {STATUS_LABEL[agent.status]}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {agent.output || "…"}
            </p>
          </section>
        ))}
      </div>

      {agents.length === 0 && !error && (
        <p className="text-sm text-gray-400">正在连接分析服务…</p>
      )}

      {finished && (
        <Link
          href={`/report/${id}`}
          className="w-fit rounded-lg bg-black px-5 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          查看完整报告 →
        </Link>
      )}
    </main>
  );
}
