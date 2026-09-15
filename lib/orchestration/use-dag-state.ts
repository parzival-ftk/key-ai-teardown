"use client";

import { useCallback, useReducer } from "react";
import type { AgentEvent } from "@/lib/types/events";
import {
  applyDagEvent,
  createInitialDagState,
  type DagState,
} from "./dag-state";

/**
 * DAG 状态 hook（W13）—— 把纯 reducer 接进 React。
 * 逻辑全在 `dag-state.ts`（可脱离 React 单测），这里只做 dispatch 接线。
 */

interface DagAction {
  event: AgentEvent;
  now: number;
}

function dagReducer(state: DagState, action: DagAction): DagState {
  return applyDagEvent(state, action.event, action.now);
}

export function useDagState(nodeIds: string[]): {
  state: DagState;
  apply: (event: AgentEvent) => void;
} {
  const [state, dispatch] = useReducer(
    dagReducer,
    nodeIds,
    createInitialDagState,
  );

  const apply = useCallback((event: AgentEvent) => {
    dispatch({ event, now: Date.now() });
  }, []);

  return { state, apply };
}
