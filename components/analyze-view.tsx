"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { deserializeAgentEvent, type AgentEvent } from "@/lib/types/events";
import type { ProductBrief } from "@/lib/types/brief";
import { summarizeEvidence, type Evidence } from "@/lib/types/evidence";
import { saveReport } from "@/lib/history";
import { EvidenceList } from "./evidence-list";
import {
  useClientSnapshot,
  useIsHydrated,
} from "@/lib/hooks/client-snapshot";
import { DAG_NODE_IDS } from "@/lib/orchestration/dagConfig";
import { useDagState } from "@/lib/orchestration/use-dag-state";
import { DAGTopologyView } from "./dag/DAGTopologyView";
import { parseReasoningTrace } from "@/lib/agent/reasoning-parser";

type AgentStatus = "running" | "done" | "error";

interface AgentState {
  agentId: string;
  name: string;
  status: AgentStatus;
  output: string;
  confidence?: number;
  evidence: Evidence[];
  /** W15：PRD 声明回应的质疑 id（供报告页做质疑↔PRD 追溯） */
  addressedCriticIds?: string[];
  /** W16：竞品维度打分（供雷达图） */
  dimensionScores?: Record<string, number>;
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

/** 本次分析的输入（sessionStorage）读取状态 */
type BriefState =
  | { kind: "ready"; brief: ProductBrief }
  | { kind: "missing" }
  | { kind: "corrupt" };

const MISSING_BRIEF: BriefState = { kind: "missing" };

/**
 * 按 id 构造输入读取器（sessionStorage），按 raw 缓存引用。
 * 经 useClientSnapshot 读取：SSR/首帧用 MISSING_BRIEF，客户端挂载后切到真实值 ——
 * 既避免 hydration mismatch，也避免「挂载时 setState」。
 */
function makeBriefReader(id: string): () => BriefState {
  let cacheKey: string | null | undefined = undefined;
  let cache: BriefState = MISSING_BRIEF;
  return () => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(`brief:${id}`);
    } catch {
      raw = null;
    }
    if (raw !== cacheKey) {
      cacheKey = raw;
      if (raw === null) {
        cache = MISSING_BRIEF;
      } else {
        try {
          const parsed = JSON.parse(raw) as ProductBrief | null;
          cache =
            parsed && typeof parsed.name === "string"
              ? { kind: "ready", brief: parsed }
              : { kind: "corrupt" };
        } catch {
          cache = { kind: "corrupt" };
        }
      }
    }
    return cache;
  };
}

export function AnalyzeView({ id }: { id: string }) {
  const hydrated = useIsHydrated();
  const readBrief = useMemo(() => makeBriefReader(id), [id]);
  const briefState = useClientSnapshot(readBrief, MISSING_BRIEF);
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  // W13：DAG 拓扑视图的状态（与流式文本视图同源，都是同一串 SSE 事件驱动）
  const { state: dagState, apply: applyDag } = useDagState(DAG_NODE_IDS);
  const [view, setView] = useState<"stream" | "dag">("stream");
  // 按 id 记忆「已启动」：reactStrictMode 下 effect 会双跑，
  // 用它避免重复发起 LLM 请求（每次都是真金白银的调用）。
  // 注意：此处刻意不在 cleanup 里 abort —— 否则 StrictMode 会取消掉唯一那次真实请求。
  const startedIdRef = useRef<string | null>(null);

  const brief = briefState.kind === "ready" ? briefState.brief : null;
  const briefName = brief?.name ?? "";
  // 输入缺失 / 损坏在渲染期判定（不再于 effect 里 setState）
  const inputError =
    hydrated && brief === null
      ? briefState.kind === "corrupt"
        ? "输入数据已损坏，请返回首页重新提交。"
        : "找不到本次分析的输入，请返回首页重新提交。"
      : null;
  const errorText = inputError ?? error;

  useEffect(() => {
    if (!brief) return;
    if (startedIdRef.current === id) return;
    startedIdRef.current = id;

    // 上面的 if (!brief) 已守卫；取别名以便在闭包内保持非空类型
    const activeBrief = brief;
    const current: AgentState[] = [];
    // W22：累积原始事件 —— 分析结束后提炼成「Agent 推理过程」时间轴
    const eventLog: AgentEvent[] = [];
    const persistReport = () => {
      const evidenceStats = summarizeEvidence(
        current.flatMap((a) => a.evidence),
      );
      const report = {
        name: activeBrief.name,
        sections: current,
        // W22：从事件流提炼结构化推理步骤（纯函数；脏数据也返回空数组，不抛错）
        reasoningTrace: parseReasoningTrace(eventLog),
      };
      try {
        sessionStorage.setItem(`report:${id}`, JSON.stringify(report));
      } catch {
        // 忽略存储失败（报告页会提示重新提交）
      }
      try {
        // 同时写入持久化历史（localStorage），供历史页跨会话回看
        saveReport(
          localStorage,
          { id, name: activeBrief.name || "未命名", evidenceStats },
          report,
        );
      } catch {
        // 历史落盘失败不阻塞报告展示
      }
    };

    const applyEvent = (event: AgentEvent) => {
      eventLog.push(event);
      switch (event.type) {
        case "agent:start":
          current.push({
            agentId: event.agentId,
            name: event.name,
            status: "running",
            output: "",
            evidence: [],
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
            a.confidence = event.confidence;
            a.evidence = event.evidence ?? [];
            a.addressedCriticIds = event.addressedCriticIds;
            a.dimensionScores = event.dimensionScores;
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
                evidence: [],
              });
          } else {
            setError(event.message);
          }
          break;
        }
        case "done":
          // 先落盘、再解锁「查看报告」，避免两者之间的竞态窗口
          persistReport();
          setFinished(true);
          break;
      }
      // W13：同一事件同时喂给拓扑视图（纯 reducer，见 lib/orchestration/dag-state）
      applyDag(event);
      setAgents([...current]);
    };

    (async () => {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeBrief),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `请求失败：HTTP ${res.status}`);
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
          if (event) applyEvent(event);
        }
      }
    })().catch((err) => {
      setError(err instanceof Error ? err.message : "未知错误");
    });
  }, [id, brief, applyDag]);

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

      {errorText && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errorText}
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="分析视图切换">
        {(
          [
            { key: "stream", label: "流式文本视图" },
            { key: "dag", label: "DAG 拓扑视图" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setView(opt.key)}
            aria-pressed={view === opt.key}
            data-view-toggle={opt.key}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              view === opt.key
                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black"
                : "border-gray-300 text-gray-600 hover:border-gray-500 dark:border-gray-700 dark:text-gray-300"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {view === "dag" && (
        <DAGTopologyView
          state={dagState}
          briefName={brief?.name}
          briefDescription={brief?.description}
          now={Date.now()}
        />
      )}

      <div
        className={
          view === "stream" ? "flex flex-col gap-4" : "hidden"
        }
      >
        {agents.map((agent, i) => (
          <section
            key={agent.agentId}
            className="key-fade-in-up rounded-xl border border-gray-200 p-4 dark:border-gray-800"
            style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status]}`}
              />
              <h2 className="font-medium">{agent.name}</h2>
              <span className="text-xs text-gray-400">
                {STATUS_LABEL[agent.status]}
              </span>
              {typeof agent.confidence === "number" && (
                <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  置信度 {agent.confidence}
                </span>
              )}
            </div>

            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {agent.output || "…"}
            </p>

            <EvidenceList evidence={agent.evidence} />
          </section>
        ))}
      </div>

      {agents.length === 0 && !errorText && view === "stream" && (
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
