"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { deserializeAgentEvent, type AgentEvent } from "@/lib/types/events";
import {
  COMPARISON_AGENT_ID,
  COMPARISON_AGENT_NAME,
  type CompareBrief,
} from "@/lib/types/compare";
import type { Evidence } from "@/lib/types/evidence";
import { EvidenceList } from "./evidence-list";
import { RadarChart, type RadarSeries } from "./comparison/RadarChart";
import {
  hasEnoughDimensions,
  normalizeDimensionScores,
} from "@/lib/report/radar-dimensions";
import {
  useClientSnapshot,
  useIsHydrated,
} from "@/lib/hooks/client-snapshot";

/**
 * 对比视图（W11）—— 流式展示「每产品编队 + 对比官」的进度与结果。
 *
 * 事件约定（见 lib/compare/run-comparison）：单产品 Agent 的 id 带命名空间
 * `p<index>:<agentId>`，对比官用 `comparison`。这里按前缀把事件归到各产品。
 *
 * 输入（sessionStorage）经 useClientSnapshot 读取而非「挂载时 setState」：
 * SSR/首帧为空、客户端挂载后切到真实值，避免 hydration mismatch 与
 * react-hooks/set-state-in-effect。产品名由输入派生，Agent 进度按 index 单独存状态。
 */

type AgentStatus = "running" | "done" | "error";

interface AgentState {
  agentId: string;
  name: string;
  status: AgentStatus;
  output: string;
}

interface ProductState {
  index: number;
  name: string;
  agents: AgentState[];
}

interface ComparisonState {
  status: AgentStatus | "idle";
  output: string;
  confidence?: number;
  evidence: Evidence[];
}

export interface CompareInitialData {
  products: string[];
  comparison: { output: string; evidence: Evidence[]; confidence?: number };
  /** W16：每个产品的维度打分（与 products 同序） */
  dimensionScores?: Array<Record<string, number>>;
}

/** 雷达图配色（2-3 个竞品可区分） */
const SERIES_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#7c3aed"];

/** 各产品的 Agent 进度，按产品下标索引 */
type AgentProgress = Record<number, AgentState[]>;

const PRODUCT_PREFIX = /^p(\d+):(.+)$/;

const STATUS_DOT: Record<AgentStatus, string> = {
  running: "bg-blue-500 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
};

const upsertAgent = (agents: AgentState[], agent: AgentState): AgentState[] =>
  agents.some((a) => a.agentId === agent.agentId) ? agents : [...agents, agent];

const appendToken = (
  agents: AgentState[],
  agentId: string,
  delta: string,
): AgentState[] =>
  agents.map((a) => (a.agentId === agentId ? { ...a, output: a.output + delta } : a));

const finishAgent = (
  agents: AgentState[],
  agentId: string,
  output: string,
): AgentState[] =>
  agents.map((a) =>
    a.agentId === agentId ? { ...a, status: "done", output: output || a.output } : a,
  );

const failAgent = (agents: AgentState[], agentId: string): AgentState[] =>
  agents.map((a) => (a.agentId === agentId ? { ...a, status: "error" } : a));

/** 对比输入（sessionStorage）读取状态 */
type CompareBriefState =
  | { kind: "ready"; brief: CompareBrief }
  | { kind: "missing" }
  | { kind: "corrupt" };

const MISSING_COMPARE: CompareBriefState = { kind: "missing" };

function makeCompareBriefReader(id: string): () => CompareBriefState {
  let cacheKey: string | null | undefined = undefined;
  let cache: CompareBriefState = MISSING_COMPARE;
  return () => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(`compare:${id}`);
    } catch {
      raw = null;
    }
    if (raw !== cacheKey) {
      cacheKey = raw;
      if (raw === null) {
        cache = MISSING_COMPARE;
      } else {
        try {
          const parsed = JSON.parse(raw) as CompareBrief | null;
          cache =
            parsed && Array.isArray(parsed.products)
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

export function CompareView({
  id,
  initialData,
}: {
  id: string;
  /** 直接注入对比结果（样例回放）；提供时跳过网络请求 */
  initialData?: CompareInitialData;
}) {
  const hydrated = useIsHydrated();
  const readBrief = useMemo(() => makeCompareBriefReader(id), [id]);
  const briefState = useClientSnapshot(readBrief, MISSING_COMPARE);
  const [agentProgress, setAgentProgress] = useState<AgentProgress>({});
  // W16：按产品下标收集维度打分（喂雷达图）；初始数据可预置（样例页）
  const [dimensionScores, setDimensionScores] = useState<
    Record<number, Record<string, number>>
  >(() => {
    const seeded: Record<number, Record<string, number>> = {};
    initialData?.dimensionScores?.forEach((scores, index) => {
      const normalized = normalizeDimensionScores(scores);
      if (hasEnoughDimensions(normalized)) seeded[index] = normalized;
    });
    return seeded;
  });
  const [comparison, setComparison] = useState<ComparisonState>(() =>
    initialData
      ? {
          status: "done",
          output: initialData.comparison.output,
          confidence: initialData.comparison.confidence,
          evidence: initialData.comparison.evidence,
        }
      : { status: "idle", output: "", evidence: [] },
  );
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(Boolean(initialData));
  const startedRef = useRef(false);

  const compareBrief =
    !initialData && briefState.kind === "ready" ? briefState.brief : null;
  const names =
    initialData?.products ?? compareBrief?.products.map((p) => p.name) ?? [];
  const products: ProductState[] = names.map((name, index) => ({
    index,
    name,
    agents: agentProgress[index] ?? [],
  }));

  // W16：把收集到的维度分拼成雷达图系列（≥2 个产品才有横向对比的意义）
  const radarSeries: RadarSeries[] = products
    .map((product, index) => {
      const scores = dimensionScores[index];
      if (!scores) return null;
      return {
        id: `p${index}`,
        label: product.name,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        scores,
      };
    })
    .filter((series): series is RadarSeries => series !== null);

  const inputError =
    !initialData && hydrated && briefState.kind !== "ready"
      ? briefState.kind === "corrupt"
        ? "输入数据已损坏，请返回首页重新提交。"
        : "找不到本次对比的输入，请返回首页重新提交。"
      : null;
  const errorText = inputError ?? error;

  useEffect(() => {
    if (!compareBrief) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const activeBrief = compareBrief;
    const editAgents = (
      index: number,
      fn: (agents: AgentState[]) => AgentState[],
    ) =>
      setAgentProgress((prev) => ({
        ...prev,
        [index]: fn(prev[index] ?? []),
      }));

    const applyEvent = (event: AgentEvent) => {
      switch (event.type) {
        case "agent:start": {
          const match = PRODUCT_PREFIX.exec(event.agentId);
          if (match) {
            const index = Number(match[1]);
            editAgents(index, (agents) =>
              upsertAgent(agents, {
                agentId: event.agentId,
                name: event.name,
                status: "running",
                output: "",
              }),
            );
          } else if (event.agentId === COMPARISON_AGENT_ID) {
            setComparison((c) => ({ ...c, status: "running" }));
          }
          break;
        }
        case "agent:token": {
          const match = PRODUCT_PREFIX.exec(event.agentId);
          if (match) {
            const index = Number(match[1]);
            editAgents(index, (agents) =>
              appendToken(agents, event.agentId, event.delta),
            );
          } else if (event.agentId === COMPARISON_AGENT_ID) {
            setComparison((c) => ({ ...c, output: c.output + event.delta }));
          }
          break;
        }
        case "agent:done": {
          const match = PRODUCT_PREFIX.exec(event.agentId);
          if (match) {
            const index = Number(match[1]);
            editAgents(index, (agents) =>
              finishAgent(agents, event.agentId, event.output),
            );
          } else if (event.agentId === COMPARISON_AGENT_ID) {
            setComparison((c) => ({
              ...c,
              status: "done",
              output: event.output || c.output,
              confidence: event.confidence,
              evidence: event.evidence ?? [],
            }));
          }
          // W16：收集维度打分（竞品分析师产出）供雷达图
          if (event.dimensionScores && match) {
            const scores = normalizeDimensionScores(event.dimensionScores);
            const index = Number(match[1]);
            if (hasEnoughDimensions(scores)) {
              setDimensionScores((prev) => ({ ...prev, [index]: scores }));
            }
          }
          break;
        }
        case "error": {
          if (event.agentId) {
            const match = PRODUCT_PREFIX.exec(event.agentId);
            if (match) {
              const index = Number(match[1]);
              const agentId = event.agentId;
              editAgents(index, (agents) => failAgent(agents, agentId));
            } else if (event.agentId === COMPARISON_AGENT_ID) {
              setComparison((c) => ({ ...c, status: "error" }));
            }
          } else {
            setError(event.message);
          }
          break;
        }
        case "done":
          setFinished(true);
          break;
      }
    };

    (async () => {
      const res = await fetch("/api/compare", {
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
  }, [id, compareBrief]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <Link href="/compare" className="text-sm text-gray-400 hover:underline">
          ← 返回
        </Link>
        <h1 className="text-2xl font-bold">多产品对比</h1>
        <p className="text-sm text-gray-400">
          每个产品独立拆解后由「对比官」产出并列对比表
        </p>
      </header>

      {errorText && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errorText}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {products.map((product, i) => (
          <section
            key={product.index}
            className="key-fade-in-up rounded-xl border border-gray-200 p-4 dark:border-gray-800"
            style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}
          >
            <h2 className="mb-2 font-medium">{product.name}</h2>
            {product.agents.length === 0 ? (
              // 样例回放（finished 且无编队事件）不显示「排队中」，避免误导为仍在运行
              finished ? null : (
                <p className="text-sm text-gray-400">排队中…</p>
              )
            ) : (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                {product.agents.map((a) => (
                  <li key={a.agentId} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[a.status]}`} />
                    {a.name}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* W16：竞品雷达图 —— 至少两个产品拿到维度分才画 */}
      {radarSeries.length >= 2 && <RadarChart series={radarSeries} size={340} />}

      {(comparison.status !== "idle" || comparison.output) && (
        <section className="key-fade-in-up rounded-xl border border-gray-200 p-5 dark:border-gray-800">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[comparison.status === "idle" ? "running" : comparison.status]}`} />
            {COMPARISON_AGENT_NAME}
            {typeof comparison.confidence === "number" && (
              <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                置信度 {comparison.confidence}
              </span>
            )}
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {comparison.output || "对比中…"}
          </p>
          <EvidenceList evidence={comparison.evidence} />
        </section>
      )}

      {products.length === 0 && !errorText && (
        <p className="text-sm text-gray-400">正在读取对比输入…</p>
      )}

      {finished && (
        <Link
          href="/compare"
          className="w-fit rounded-lg bg-black px-5 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          ← 再做一组对比
        </Link>
      )}
    </main>
  );
}
