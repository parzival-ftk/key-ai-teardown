"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { deserializeAgentEvent, type AgentEvent } from "@/lib/types/events";
import {
  COMPARISON_AGENT_ID,
  COMPARISON_AGENT_NAME,
  type CompareBrief,
} from "@/lib/types/compare";
import type { Evidence } from "@/lib/types/evidence";
import { EvidenceList } from "./evidence-list";

/**
 * 对比视图（W11）—— 流式展示「每产品编队 + 对比官」的进度与结果。
 *
 * 事件约定（见 lib/compare/run-comparison）：单产品 Agent 的 id 带命名空间
 * `p<index>:<agentId>`，对比官用 `comparison`。这里按前缀把事件归到各产品。
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
}

const PRODUCT_PREFIX = /^p(\d+):(.+)$/;

const STATUS_DOT: Record<AgentStatus, string> = {
  running: "bg-blue-500 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
};

const mapProduct = (
  products: ProductState[],
  index: number,
  fn: (agents: AgentState[]) => AgentState[],
): ProductState[] =>
  products.map((p) => (p.index === index ? { ...p, agents: fn(p.agents) } : p));

const upsertAgent = (
  products: ProductState[],
  index: number,
  agent: AgentState,
): ProductState[] =>
  mapProduct(products, index, (agents) =>
    agents.some((a) => a.agentId === agent.agentId) ? agents : [...agents, agent],
  );

const appendToken = (
  products: ProductState[],
  index: number,
  agentId: string,
  delta: string,
): ProductState[] =>
  mapProduct(products, index, (agents) =>
    agents.map((a) => (a.agentId === agentId ? { ...a, output: a.output + delta } : a)),
  );

const finishAgent = (
  products: ProductState[],
  index: number,
  agentId: string,
  output: string,
): ProductState[] =>
  mapProduct(products, index, (agents) =>
    agents.map((a) =>
      a.agentId === agentId ? { ...a, status: "done", output: output || a.output } : a,
    ),
  );

const failAgent = (
  products: ProductState[],
  index: number,
  agentId: string,
): ProductState[] =>
  mapProduct(products, index, (agents) =>
    agents.map((a) => (a.agentId === agentId ? { ...a, status: "error" } : a)),
  );

export function CompareView({
  id,
  initialData,
}: {
  id: string;
  /** 直接注入对比结果（样例回放）；提供时跳过网络请求 */
  initialData?: CompareInitialData;
}) {
  const [products, setProducts] = useState<ProductState[]>(() =>
    (initialData?.products ?? []).map((name, index) => ({
      index,
      name,
      agents: [],
    })),
  );
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

  useEffect(() => {
    if (initialData || startedRef.current) return;
    startedRef.current = true;

    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(`compare:${id}`);
    } catch {
      raw = null;
    }
    if (!raw) {
      setError("找不到本次对比的输入，请返回首页重新提交。");
      return;
    }

    let compareBrief: CompareBrief;
    try {
      compareBrief = JSON.parse(raw) as CompareBrief;
    } catch {
      setError("输入数据已损坏，请返回首页重新提交。");
      return;
    }
    setProducts(
      compareBrief.products.map((p, index) => ({
        index,
        name: p.name,
        agents: [],
      })),
    );

    const applyEvent = (event: AgentEvent) => {
      switch (event.type) {
        case "agent:start": {
          const match = PRODUCT_PREFIX.exec(event.agentId);
          if (match) {
            const index = Number(match[1]);
            setProducts((prev) =>
              upsertAgent(prev, index, {
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
            setProducts((prev) =>
              appendToken(prev, index, event.agentId, event.delta),
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
            setProducts((prev) =>
              finishAgent(prev, index, event.agentId, event.output),
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
          break;
        }
        case "error": {
          if (event.agentId) {
            const match = PRODUCT_PREFIX.exec(event.agentId);
            if (match) {
              const index = Number(match[1]);
              setProducts((prev) => failAgent(prev, index, event.agentId!));
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
        body: JSON.stringify(compareBrief),
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
  }, [id, initialData]);

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

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
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

      {products.length === 0 && !error && (
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
