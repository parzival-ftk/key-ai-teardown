"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasViewport } from "@/components/canvas/CanvasViewport";
import { AnalyzePanel } from "./AnalyzePanel";
import { ComponentTreePanel } from "./ComponentTreePanel";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { Inspector } from "./Inspector";
import type { CanvasNode } from "@/lib/canvas/canvas-node";
import { EXAMPLE_PROJECT_ID } from "@/lib/components/demo-project";
import {
  applyCanvasToTree,
  assetsToCanvasNodes,
  treeToCanvasNodes,
} from "@/lib/components/tree-to-canvas";
import { descendantsOf, updateComponent } from "@/lib/components/tree";
import { componentPrompt } from "@/lib/components/prompt";
import {
  browserProjectStore,
  ensureExampleProject,
  getProject,
  saveProject,
} from "@/lib/components/project-store";
import {
  INITIAL_ANALYZE_STATE,
  analyzeReducer,
  type AnalyzeState,
} from "@/lib/components/analysis/status";
import { readFileAsDataUrl, toAnalysisInput } from "@/lib/components/analysis/image-input";
import { runAnalysis } from "@/lib/components/analysis/service";
import { requestGeneration } from "@/lib/components/generation";
import type { Project } from "@/lib/components/types";

/**
 * 项目工作区（阶段 15，spec §3 的产品闭环）。
 *
 * 组合：组件树面板 + 无限画布 + Inspector + 截图分析面板。
 *
 * 状态归属（单一真相）：
 *   - `project`：结构（组件树）、资产、分析来源 —— 落 localStorage。
 *   - `nodes`  ：画布几何（受控给 CanvasViewport）—— 拖动时高频变化，经 400ms 防抖回写树。
 *   - `selection` / `analyze`：纯 UI 状态。
 *
 * 生成链路：Inspector → requestGeneration → /api/generate → ComfyUIProvider →
 * GeneratedAsset（绑定 componentId）→ 追加到画布。
 */

export interface WorkspaceViewProps {
  projectId: string;
}

type LoadStatus = "loading" | "ready" | "missing";

export function WorkspaceView({ projectId }: WorkspaceViewProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [nodes, setNodesState] = useState<CanvasNode[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [analyze, setAnalyze] = useState<AnalyzeState>(INITIAL_ANALYZE_STATE);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const projectRef = useRef<Project | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setNodes = useCallback(
    (next: CanvasNode[] | ((current: CanvasNode[]) => CanvasNode[])) => {
      const value = typeof next === "function" ? next(nodesRef.current) : next;
      nodesRef.current = value;
      setNodesState(value);
    },
    [],
  );

  const persist = useCallback((next: Project) => {
    projectRef.current = next;
    setProject(next);
    const store = browserProjectStore();
    if (store) saveProject(store, next);
  }, []);

  const mutateProject = useCallback(
    (mutator: (current: Project) => Project) => {
      const current = projectRef.current;
      if (!current) return;
      const next = mutator(current);
      if (next === current) return;
      persist(next);
    },
    [persist],
  );

  /* 几何回写：拖动/拉伸是高频操作，防抖后一次性写回组件树与 localStorage */
  const scheduleGeometrySave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const current = projectRef.current;
      const store = browserProjectStore();
      if (!current || !store) return;
      const tree = applyCanvasToTree(current.tree, nodesRef.current);
      if (tree === current.tree) return;
      const next = { ...current, tree, updatedAt: Date.now() };
      projectRef.current = next;
      setProject(next);
      saveProject(store, next);
    }, 400);
  }, []);

  /* 载入项目（示例项目缺失时自动安装） */
  useEffect(() => {
    const store = browserProjectStore();
    if (!store) {
      setStatus("missing");
      return;
    }
    let found = getProject(store, projectId);
    if (!found && projectId === EXAMPLE_PROJECT_ID) found = ensureExampleProject(store);
    if (!found) {
      setStatus("missing");
      return;
    }
    projectRef.current = found;
    setProject(found);
    const initial = [
      ...treeToCanvasNodes(found.tree),
      ...assetsToCanvasNodes(found.tree, found.assets),
    ];
    nodesRef.current = initial;
    setNodesState(initial);
    setSelection([]);
    setStatus("ready");
  }, [projectId]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const handleNodesChange = useCallback(
    (next: CanvasNode[]) => {
      setNodes(next);
      scheduleGeometrySave();
    },
    [setNodes, scheduleGeometrySave],
  );

  const handleSelect = useCallback((id: string) => setSelection([id]), []);

  const handlePromptChange = useCallback(
    (id: string, prompt: string) => {
      mutateProject((current) => ({
        ...current,
        tree: updateComponent(current.tree, id, { prompt }),
        updatedAt: Date.now(),
      }));
    },
    [mutateProject],
  );

  const handleCopyPrompt = useCallback(async (prompt: string) => {
    try {
      await navigator.clipboard?.writeText(prompt);
    } catch {
      /* 剪贴板不可用：忽略 */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const handleGenerate = useCallback(
    async (componentId: string) => {
      const current = projectRef.current;
      if (!current || generating) return;
      const prompt = componentPrompt(current.tree, componentId).trim();
      if (!prompt) {
        setGenerationError("该组件没有可用的 Prompt");
        return;
      }
      setGenerating(true);
      setGenerationError(null);
      const outcome = await requestGeneration(componentId, { prompt });
      if (outcome.ok) {
        const asset = outcome.asset;
        const added = assetsToCanvasNodes(current.tree, [asset], nodesRef.current);
        setNodes([...nodesRef.current, ...added]);
        mutateProject((p) => ({ ...p, assets: [...p.assets, asset], updatedAt: Date.now() }));
      } else {
        setGenerationError(outcome.code ? `${outcome.code}：${outcome.error}` : outcome.error);
      }
      setGenerating(false);
    },
    [generating, mutateProject, setNodes],
  );

  const handleSelectFile = useCallback(async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const parsed = toAnalysisInput(dataUrl, file.name);
      if (!parsed.ok) {
        setAnalyze((s) => analyzeReducer(s, { type: "fail", error: parsed.error }));
        return;
      }
      setAnalyze(
        analyzeReducer(INITIAL_ANALYZE_STATE, {
          type: "select",
          imageDataUrl: parsed.input.imageDataUrl,
          mimeType: parsed.input.mimeType,
          ...(parsed.input.fileName ? { fileName: parsed.input.fileName } : {}),
        }),
      );
    } catch (error) {
      setAnalyze((s) =>
        analyzeReducer(s, {
          type: "fail",
          error: error instanceof Error ? error.message : "读取图片失败",
        }),
      );
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    const state = analyze;
    if (!state.imageDataUrl) return;
    setAnalyze((s) => analyzeReducer(s, { type: "analyze" }));
    try {
      const result = await runAnalysis({
        imageDataUrl: state.imageDataUrl,
        mimeType: state.mimeType ?? "image/png",
        ...(state.fileName ? { fileName: state.fileName } : {}),
      });
      setAnalyze((s) => analyzeReducer(s, { type: "build" }));
      const keptAssets = projectRef.current?.assets ?? [];
      setNodes([
        ...treeToCanvasNodes(result.tree),
        ...assetsToCanvasNodes(result.tree, keptAssets),
      ]);
      setSelection([]);
      mutateProject((p) => ({
        ...p,
        tree: result.tree,
        analysisSource: result.source,
        imageDataUrl: state.imageDataUrl,
        updatedAt: Date.now(),
      }));
      setAnalyze((s) => analyzeReducer(s, { type: "ready" }));
    } catch (error) {
      setAnalyze((s) =>
        analyzeReducer(s, {
          type: "fail",
          error: error instanceof Error ? error.message : "分析失败",
        }),
      );
    }
  }, [analyze, mutateProject, setNodes]);

  const handleResetAnalyze = useCallback(() => setAnalyze(INITIAL_ANALYZE_STATE), []);

  /* 拖父带子：拖动父组件时一并移动其后代（组件树为嵌套 frame 版式） */
  const dragGroup = useCallback((nodeId: string) => {
    const current = projectRef.current;
    if (!current) return [nodeId];
    const node = current.tree.nodes[nodeId];
    if (!node) return [nodeId];
    return [nodeId, ...descendantsOf(current.tree, nodeId).map((n) => n.id)];
  }, []);

  if (status === "loading") {
    return (
      <main data-workspace-loading className="p-8 text-sm text-gray-400">
        加载项目…
      </main>
    );
  }

  if (status === "missing" || !project) {
    return (
      <main data-workspace-missing className="flex flex-col gap-3 p-8 text-sm">
        <p className="text-gray-500">找不到该项目（可能已被删除）。</p>
        <Link href="/projects" className="text-indigo-500 underline">
          ← 返回项目列表
        </Link>
      </main>
    );
  }

  const analysisLabel =
    project.analysisSource === "real" ? "REAL" : project.analysisSource ? "DEMO" : "未使用";
  const selectedId = selection.length === 1 ? selection[0] : null;

  return (
    <main data-workspace className="flex h-screen flex-col gap-2 p-3 text-sm">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/projects" className="text-xs text-gray-400 hover:underline">
          ← 项目
        </Link>
        <h1 data-workspace-title className="text-base font-semibold">
          {project.name}
        </h1>
        <span data-workspace-analysis-source className="text-[11px] text-gray-500">
          截图分析：{analysisLabel}
        </span>
        <span className="ml-auto text-[11px] text-gray-400">
          Canvas REAL · Persistence REAL · ComfyUI REAL · 截图分析 DEMO
        </span>
      </header>

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex w-72 shrink-0 flex-col gap-2">
          <ComponentTreePanel tree={project.tree} selection={selection} onSelect={handleSelect} />
          <AnalyzePanel
            state={analyze}
            source={project.analysisSource}
            onSelectFile={handleSelectFile}
            onAnalyze={handleAnalyze}
            onReset={handleResetAnalyze}
          />
        </div>

        <CanvasViewport
          className="h-full min-h-0"
          nodes={nodes}
          onNodesChange={handleNodesChange}
          selection={selection}
          onSelectionChange={setSelection}
          showLayers={false}
          showProperties={false}
          showInpaintBar={false}
          dragGroup={dragGroup}
          renderOverlay={(viewport) => (
            <ConnectionOverlay tree={project.tree} nodes={nodes} viewport={viewport} />
          )}
        />

        <Inspector
          tree={project.tree}
          componentId={selectedId}
          assets={project.assets}
          generating={generating}
          error={generationError}
          canGenerate={Boolean(selectedId) && !generating}
          analysisSource={project.analysisSource}
          copied={copied}
          onPromptChange={handlePromptChange}
          onGenerate={handleGenerate}
          onCopyPrompt={handleCopyPrompt}
          onRegenerate={handleGenerate}
          onOpenAsset={(asset) => {
            if (asset.url && typeof window !== "undefined") window.open(asset.url, "_blank");
          }}
          onUseAsset={(asset) => {
            if (asset.url) setSelection([asset.componentId]);
          }}
        />
      </div>
    </main>
  );
}
