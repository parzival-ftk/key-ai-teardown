"use client";

import type { DagEdgeConfig } from "@/lib/orchestration/dagConfig";
import { edgePath, type DagLayout } from "@/lib/orchestration/dag-layout";
import { edgeFlow, type DagState } from "@/lib/orchestration/dag-state";

/** 边状态 → 描边样式；`flowing` 额外挂流动光效类（见 app/globals.css） */
const EDGE_STROKE: Record<ReturnType<typeof edgeFlow>, string> = {
  idle: "stroke-gray-200 dark:stroke-gray-800",
  flowing: "stroke-blue-500",
  settled: "stroke-green-400 dark:stroke-green-700",
};

export function DagEdges({
  edges,
  layout,
  state,
}: {
  edges: DagEdgeConfig[];
  layout: DagLayout;
  state: DagState;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      data-dag-edges
    >
      <defs>
        <marker
          id="dag-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-gray-300 dark:fill-gray-700" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const from = layout.positions[edge.from];
        const to = layout.positions[edge.to];
        if (!from || !to) return null;
        const flow = edgeFlow(edge, state);
        const key = `${edge.from}->${edge.to}`;
        return (
          <path
            key={key}
            d={edgePath(from, to, layout.metrics)}
            data-dag-edge={key}
            data-dag-flow={flow}
            markerEnd="url(#dag-arrow)"
            className={`fill-none stroke-2 ${EDGE_STROKE[flow]} ${
              flow === "flowing" ? "dag-edge-flow" : ""
            }`}
          />
        );
      })}
    </svg>
  );
}
