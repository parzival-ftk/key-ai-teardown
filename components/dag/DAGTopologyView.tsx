"use client";

import { useState } from "react";
import {
  DAG_CONFIG,
  DAG_LAYER_LABELS,
  DAG_NODE_BY_ID,
} from "@/lib/orchestration/dagConfig";
import { computeDagLayout, DAG_LAYOUT } from "@/lib/orchestration/dag-layout";
import { summarizeDag, type DagState } from "@/lib/orchestration/dag-state";
import { DagNode } from "./DagNode";
import { DagEdges } from "./DagEdges";
import { NodeInspector } from "./NodeInspector";

/**
 * DAG 实时拓扑视图（W13）。
 *
 * 零外部依赖：布局是**确定性坐标**（层→列、层内序→行，见 dag-layout），
 * 连线用原生 `<svg>` 画贝塞尔；节点用绝对定位的按钮。节点与 SVG 共享同一套坐标，
 * 因此不需要 DOM 测量、不需要 effect、也不会首帧闪烁。
 *
 * 布局常量在模块级算一次（拓扑是静态的），避免每帧重算。
 */
const LAYOUT = computeDagLayout(DAG_CONFIG);

export interface DAGTopologyViewProps {
  state: DagState;
  briefName?: string;
  briefDescription?: string;
  /** 渲染时刻（毫秒）——用于显示运行中节点的耗时，无需额外定时器 */
  now: number;
}

export function DAGTopologyView({
  state,
  briefName,
  briefDescription,
  now,
}: DAGTopologyViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const progress = summarizeDag(state);
  const selected = selectedId ? DAG_NODE_BY_ID[selectedId] : undefined;

  return (
    <section
      data-dag-topology
      className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>
          流水线拓扑（{DAG_CONFIG.layerCount} 层 · {DAG_CONFIG.nodes.length} 个 Agent）
        </span>
        <span className="tabular-nums" data-dag-progress>
          已完成 {progress.completed}/{progress.total}
        </span>
        {progress.running > 0 && (
          <span className="text-blue-600 dark:text-blue-400">
            进行中 {progress.running}
          </span>
        )}
        {progress.failed > 0 && (
          <span className="text-red-600 dark:text-red-400">
            失败 {progress.failed}
          </span>
        )}
        <span className="ml-auto hidden text-gray-400 sm:inline">
          点击节点查看 Prompt / 依赖 / 产出
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        {/* 层标签：与列同 x 对齐（同一套布局坐标） */}
        <div
          className="relative mb-1 h-4"
          style={{ width: LAYOUT.width }}
          aria-hidden="true"
        >
          {DAG_CONFIG.layers.map((layer, index) => (
            <span
              key={layer[0]}
              className="absolute text-[10px] text-gray-400"
              style={{
                left: LAYOUT.positions[layer[0]].x,
                top: 0,
                width: DAG_LAYOUT.nodeWidth,
                textAlign: "center",
              }}
            >
              {DAG_LAYER_LABELS[index] ?? `L${index}`}
            </span>
          ))}
        </div>

        <div
          className="relative"
          style={{ width: LAYOUT.width, height: LAYOUT.height }}
        >
          <DagEdges edges={DAG_CONFIG.edges} layout={LAYOUT} state={state} />
          {DAG_CONFIG.nodes.map((node) => (
            <DagNode
              key={node.id}
              node={node}
              state={state[node.id]}
              now={now}
              selected={selectedId === node.id}
              onSelect={(id) =>
                setSelectedId((prev) => (prev === id ? null : id))
              }
              style={{
                left: LAYOUT.positions[node.id].x,
                top: LAYOUT.positions[node.id].y,
                width: DAG_LAYOUT.nodeWidth,
                height: DAG_LAYOUT.nodeHeight,
              }}
            />
          ))}
        </div>
      </div>

      {selected && (
        <NodeInspector
          node={selected}
          state={state[selected.id]}
          nodesById={DAG_NODE_BY_ID}
          briefName={briefName}
          briefDescription={briefDescription}
          now={now}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}
