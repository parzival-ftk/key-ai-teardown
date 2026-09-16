"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_VIEWPORT,
  GRID_SIZE,
  ZOOM_STEP,
  canvasToScreen,
  centerOf,
  fitToRect,
  formatZoom,
  panBy,
  screenToCanvas,
  zoomAt,
  type Point,
  type Rect,
  type Viewport,
} from "@/lib/canvas/viewport";
import {
  MIN_NODE_SIZE,
  NODE_TYPE_LABEL,
  RESIZE_HANDLES,
  boundsOf,
  bringToFront,
  createCanvasNode,
  moveNodes,
  nodesInRect,
  normalizeRect,
  removeNodes,
  resizeNode,
  sendToBack,
  sortByZ,
  updateNode,
  type CanvasNode,
  type CanvasNodeType,
  type ResizeHandle,
} from "@/lib/canvas/canvas-node";
import {
  ComfyClient,
  buildInpaintWorkflow,
  toResultCanvasNode,
  type ComfyBridgeConfig,
  type ComfyClientEvents,
  type ComfyConnectionState,
} from "@/lib/canvas/comfy-bridge";

/**
 * Inpaint 的**环境边界**（可注入）：与浏览器/网络打交道的三件事抽成端口，
 * 测试因此能跑完整条链路（选节点 → 上传 → 提交 → 进度 → 落图）而不必连真实后端。
 * 缺省实现就是浏览器里要用的真货。
 */
export interface InpaintPorts {
  /** 建立 ComfyClient（测试注入带假传输的实例） */
  createClient: (config: ComfyBridgeConfig, events: ComfyClientEvents) => ComfyClient;
  /** 把节点的 src 取成 Blob（浏览器用 fetch） */
  loadImageBlob: (src: string) => Promise<Blob>;
  /** 按选区尺寸生成白底遮罩（浏览器用 canvas 画，白色 = 重绘区域） */
  createMask: (size: { width: number; height: number }) => Promise<Blob>;
}

/** 浏览器缺省实现 */
export const defaultInpaintPorts: InpaintPorts = {
  createClient: (config, events) => new ComfyClient(config, events),
  loadImageBlob: async (src) => {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`读取图片失败：HTTP ${response.status}`);
    return response.blob();
  },
  createMask: async ({ width, height }) => {
    if (typeof document === "undefined") {
      throw new Error("当前环境不支持 2D 画布，无法生成遮罩");
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前环境不支持 2D 画布，无法生成遮罩");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("遮罩生成失败（canvas.toBlob 返回空）");
    return blob;
  },
};

/** ComfyUI 默认地址（本地部署的默认端口） */
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";

/** 只有「带图片的节点」能被重绘 —— 画框/prompt 节点没有像素可改 */
function canInpaint(node: CanvasNode | null): boolean {
  return Boolean(node && node.type === "image" && node.src);
}

/**
 * Figma 式无限画布（W29）。
 *
 * 零依赖：不引入任何画布/图形框架，节点是绝对定位的 DOM，视口变换是纯数学
 * （`lib/canvas/viewport`），几何操作是纯函数（`lib/canvas/canvas-node`）。
 *
 * 手势（全部走 Pointer Events + `setPointerCapture`，不挂 window 监听）：
 *   - 平移：按住 Space 拖拽，或中键拖拽
 *   - 缩放：Ctrl/Cmd + 滚轮（以光标为锚点）；工具栏 ± 以视口中心为锚点
 *   - 选择：点空白拖出选框（与矩形相交即选中）；Shift 点击加选
 *   - 移动/拉伸：拖节点本体 / 拖 8 个手柄（单选用）
 *
 * 键盘：Delete/Backspace 删除选中节点；Space 切换平移态。
 */

export type CanvasTool = "select" | "frame" | "prompt" | "shape";

export const CANVAS_TOOLS: { key: CanvasTool; label: string; hint: string }[] = [
  { key: "select", label: "选择", hint: "V" },
  { key: "frame", label: "画框", hint: "F" },
  { key: "prompt", label: "Prompt", hint: "P" },
  { key: "shape", label: "图形", hint: "R" },
];

/** 新建节点默认尺寸（点击放置时） */
const DEFAULT_NODE_SIZE = { width: 200, height: 140 };

/** 判定「点击放置」还是「拖拽成形」的阈值（屏幕像素） */
const DRAG_THRESHOLD = 8;

const TOOL_NODE_TYPE: Record<Exclude<CanvasTool, "select">, CanvasNodeType> = {
  frame: "frame",
  prompt: "prompt",
  shape: "component",
};

/**
 * 指针捕获：对非活跃 pointerId（合成事件、已释放的指针）会抛 NotFoundError，
 * 捕获失败不影响手势本身（移动事件仍会冒泡到画布），故静默降级。
 */
function capturePointer(element: HTMLElement | null, pointerId: number) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    /* 指针不活跃：忽略 */
  }
}

function releasePointer(element: HTMLElement | null, pointerId: number) {
  try {
    element?.releasePointerCapture?.(pointerId);
  } catch {
    /* 未捕获或不活跃：忽略 */
  }
}

type DragState =
  | { kind: "none" }
  | { kind: "pan"; last: Point }
  | { kind: "move"; last: Point; moved: boolean; ids: string[] }
  | { kind: "resize"; handle: ResizeHandle; last: Point; nodeId: string }
  | { kind: "marquee"; anchor: Point; current: Point }
  | { kind: "create"; anchor: Point; current: Point; tool: Exclude<CanvasTool, "select"> };

export interface CanvasViewportProps {
  /** 初始节点（受控场景可注入） */
  initialNodes?: CanvasNode[];
  /** Inpaint 端口（缺省用浏览器实现） */
  inpaintPorts?: InpaintPorts;
  /** ComfyUI 服务地址初值 */
  comfyServerUrl?: string;
}

export function CanvasViewport({
  initialNodes = [],
  inpaintPorts,
  comfyServerUrl = DEFAULT_COMFY_URL,
}: CanvasViewportProps) {
  const ports = inpaintPorts ?? defaultInpaintPorts;
  const [nodes, setNodes] = useState<CanvasNode[]>(initialNodes);
  const [viewport, setViewport] = useState<Viewport>({ ...DEFAULT_VIEWPORT });
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [spaceDown, setSpaceDown] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** 拖拽中的选框（**必须是 state**：ref 不能在渲染期读取） */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /* W31：ComfyUI inpaint —— 提示词 / 进行中 / 进度 / 错误 / 服务地址 */
  const [promptText, setPromptText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(comfyServerUrl);
  /** 连接阶段（握手/重连可能要数秒，界面得说清在等什么） */
  const [comfyState, setComfyState] = useState<ComfyConnectionState>("idle");

  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({ kind: "none" });
  /** 手势开始时的节点快照：拉伸期间基于它增量计算，避免累积误差 */
  const snapshotRef = useRef<CanvasNode[]>([]);

  /* Space 切换平移态；Delete/Backspace 删除选中（监听器随 selection 重注册） */
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selection.length > 0
      ) {
        setNodes((current) => removeNodes(current, selection));
        setSelection([]);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [selection]);

  /* 视口尺寸：ResizeObserver 只写 state；不支持该 API 的环境（jsdom / 老浏览器）只量一次 */
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectedNodes = useMemo(
    () => nodes.filter((node) => selection.includes(node.id)),
    [nodes, selection],
  );
  const marqueeRect = marquee;
  const box = useMemo(() => boundsOf(selectedNodes), [selectedNodes]);

  const toCanvas = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const screen = {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
      };
      return screenToCanvas(viewport, screen);
    },
    [viewport],
  );

  const localScreen = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }, []);

  /** 把一张本地图片落成画布节点（inpaint 的必需前提：没有图片节点就无从重绘） */
  const ingestImageFile = useCallback((file: File | null | undefined, at: Point) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (!src) return;
      setNodes((current) => [
        ...current,
        createCanvasNode(
          {
            type: "image",
            x: at.x,
            y: at.y,
            width: DEFAULT_NODE_SIZE.width,
            height: DEFAULT_NODE_SIZE.height,
            label: file.name || "图片",
            src,
          },
          current,
        ),
      ]);
    };
    reader.readAsDataURL(file);
  }, []);

  /* 粘贴图片 → 落到视口中心附近 */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        const center = screenToCanvas(viewport, centerOf(size));
        ingestImageFile(file, {
          x: center.x - DEFAULT_NODE_SIZE.width / 2,
          y: center.y - DEFAULT_NODE_SIZE.height / 2,
        });
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [viewport, size, ingestImageFile]);

  /* ── 手势 ── */

  function beginPan(event: React.PointerEvent) {
    dragRef.current = { kind: "pan", last: { x: event.clientX, y: event.clientY } };
    capturePointer(surfaceRef.current, event.pointerId);
  }

  function onSurfacePointerDown(event: React.PointerEvent) {
    if (event.button === 1 || spaceDown || tool === "select") {
      // 中键 / Space / 选择工具下的空白区
      if (event.button === 1 || spaceDown) {
        beginPan(event);
        return;
      }
      setSelection([]);
      dragRef.current = {
        kind: "marquee",
        anchor: toCanvas(event),
        current: toCanvas(event),
      };
      capturePointer(surfaceRef.current, event.pointerId);
      return;
    }
    // 绘制工具：拖出成形
    dragRef.current = {
      kind: "create",
      anchor: toCanvas(event),
      current: toCanvas(event),
      tool: tool as Exclude<CanvasTool, "select">,
    };
    capturePointer(surfaceRef.current, event.pointerId);
  }

  function onNodePointerDown(event: React.PointerEvent, node: CanvasNode) {
    if (spaceDown || event.button === 1) {
      beginPan(event);
      return;
    }
    event.stopPropagation();
    const additive = event.shiftKey;
    const alreadySelected = selection.includes(node.id);
    // 手势自带主体：移动目标在此刻定下，不依赖「down 与 move 之间发生过重渲染」
    const nextSelection = additive
      ? alreadySelected
        ? selection.filter((id) => id !== node.id)
        : [...selection, node.id]
      : alreadySelected
        ? selection
        : [node.id];
    setSelection(nextSelection);
    setNodes((current) => bringToFront(current, node.id));
    snapshotRef.current = nodes;
    dragRef.current = {
      kind: "move",
      ids: nextSelection,
      last: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    capturePointer(surfaceRef.current, event.pointerId);
  }

  function onHandlePointerDown(event: React.PointerEvent, handle: ResizeHandle) {
    event.stopPropagation();
    const node = selectedNodes[0];
    if (!node) return;
    snapshotRef.current = nodes;
    dragRef.current = {
      kind: "resize",
      handle,
      nodeId: node.id,
      last: { x: event.clientX, y: event.clientY },
    };
    capturePointer(surfaceRef.current, event.pointerId);
  }

  function onSurfacePointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag.kind === "none") return;

    if (drag.kind === "pan") {
      setViewport((current) =>
        panBy(current, event.clientX - drag.last.x, event.clientY - drag.last.y),
      );
      dragRef.current = { kind: "pan", last: { x: event.clientX, y: event.clientY } };
      return;
    }

    if (drag.kind === "marquee" || drag.kind === "create") {
      const current = toCanvas(event);
      dragRef.current = { ...drag, current };
      setMarquee(normalizeRect(drag.anchor, current));
      return;
    }

    const dxScreen = event.clientX - drag.last.x;
    const dyScreen = event.clientY - drag.last.y;

    if (drag.kind === "move") {
      const ids = drag.ids;
      setNodes((current) =>
        moveNodes(current, ids, dxScreen / viewport.scale, dyScreen / viewport.scale),
      );
      dragRef.current = {
        kind: "move",
        ids,
        last: { x: event.clientX, y: event.clientY },
        moved: true,
      };
      return;
    }

    if (drag.kind === "resize") {
      const node = snapshotRef.current.find((item) => item.id === drag.nodeId);
      if (!node) return;
      setNodes((current) =>
        updateNode(
          current,
          drag.nodeId,
          resizeNode(
            node,
            drag.handle,
            (event.clientX - drag.last.x) / viewport.scale,
            (event.clientY - drag.last.y) / viewport.scale,
          ),
        ),
      );
      dragRef.current = { ...drag, last: { x: event.clientX, y: event.clientY } };
    }
  }

  function onSurfacePointerUp(event: React.PointerEvent) {
    const drag = dragRef.current;
    dragRef.current = { kind: "none" };
    setMarquee(null);
    releasePointer(surfaceRef.current, event.pointerId);

    if (drag.kind === "marquee") {
      const rect = normalizeRect(drag.anchor, drag.current);
      const hits = nodesInRect(nodes, rect);
      // 点空白（没有拖出面积）→ 已在 pointerdown 清空选择
      if (rect.width > 2 || rect.height > 2) {
        setSelection(hits.map((node) => node.id));
      }
      return;
    }

    if (drag.kind === "create") {
      const rect = normalizeRect(drag.anchor, drag.current);
      const type = TOOL_NODE_TYPE[drag.tool];
      const isClick =
        rect.width < DRAG_THRESHOLD / viewport.scale &&
        rect.height < DRAG_THRESHOLD / viewport.scale;
      const node = createCanvasNode(
        {
          type,
          x: drag.anchor.x,
          y: drag.anchor.y,
          width: isClick ? DEFAULT_NODE_SIZE.width : Math.max(rect.width, MIN_NODE_SIZE),
          height: isClick ? DEFAULT_NODE_SIZE.height : Math.max(rect.height, MIN_NODE_SIZE),
          label: NODE_TYPE_LABEL[type],
        },
        nodes,
      );
      setNodes((current) => [...current, node]);
      setSelection([node.id]);
      setTool("select");
    }
  }

  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return; // 普通滚轮不拦截（保留页面滚动）
    event.preventDefault();
    const anchor = localScreen(event);
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setViewport((current) => zoomAt(current, factor, anchor));
  }

  function zoomByStep(factor: number) {
    setViewport((current) => zoomAt(current, factor, centerOf(size)));
  }

  function fitContent() {
    setViewport(fitToRect(boundsOf(nodes), size));
  }

  function resetViewportState() {
    setViewport({ ...DEFAULT_VIEWPORT });
  }

  /**
   * 提交一次 inpaint：连 ComfyUI → 上传原图与遮罩 → 提交 workflow → 结果落回**原选区坐标**。
   *
   * 一次生成一个连接（用完即关）。失败路径统一落到 `genError`，且不会让 loading 卡住
   * —— `connect()` 保证 settle（此前会永久挂起，已在桥接层修掉）。
   */
  async function handleInpaintSubmit() {
    const node = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const instruction = promptText.trim();
    if (!node || !instruction || isGenerating) return;
    if (!canInpaint(node)) {
      setGenError("只有带图片的节点可以重绘");
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    setGenError(null);
    setComfyState("connecting");

    const client = ports.createClient(
      {
        baseUrl: serverUrl,
        timeoutMs: 120_000,
        maxReconnects: 1,
        reconnectDelayMs: 400,
      },
      {
        onState: (state) => setComfyState(state),
        onProgress: (percent) => setProgress(percent),
        onError: (error) => setGenError(error.message),
      },
    );

    try {
      await client.connect();
      const bounds = { x: node.x, y: node.y, width: node.width, height: node.height };
      const [imageBlob, maskBlob] = await Promise.all([
        ports.loadImageBlob(node.src as string),
        ports.createMask({ width: node.width, height: node.height }),
      ]);
      // ComfyUI 只认 input 目录里的文件名 —— 必须先上传，再建引用文件名的 workflow
      const imageName = await client.uploadImage("canvas-base.png", imageBlob);
      const maskName = await client.uploadImage("canvas-mask.png", maskBlob);
      const result = await client.generate(
        buildInpaintWorkflow({ prompt: instruction, imageName, maskName }),
      );
      setNodes((current) => [...current, toResultCanvasNode(result, bounds, current)]);
    } catch (error) {
      setGenError(error instanceof Error ? error.message : "生成失败");
    } finally {
      client.close();
      setIsGenerating(false);
      setProgress(null);
    }
  }

  /* ── 渲染 ── */

  const gridSize = GRID_SIZE * viewport.scale;
  const gridStyle = useMemo(
    () => ({
      backgroundImage:
        "linear-gradient(to right, rgba(120,120,120,0.18) 1px, transparent 1px)," +
        "linear-gradient(to bottom, rgba(120,120,120,0.18) 1px, transparent 1px)",
      backgroundSize: `${gridSize}px ${gridSize}px`,
      backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    }),
    [gridSize, viewport.x, viewport.y],
  );

  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;

  return (
    <div data-canvas-root className="flex h-[70vh] min-h-[420px] w-full gap-2">
      {/* 图层面板 */}
      <aside
        data-canvas-layers
        className="flex w-44 shrink-0 flex-col gap-1 overflow-auto rounded-xl border border-gray-200 p-2 text-xs dark:border-gray-800"
      >
        <span className="px-1 font-medium text-gray-500 dark:text-gray-400">
          图层（{nodes.length}）
        </span>
        {nodes.length === 0 && <p className="px-1 text-gray-400">还没有元素</p>}
        {sortByZ(nodes)
          .reverse()
          .map((node) => {
            const active = selection.includes(node.id);
            return (
              <button
                key={node.id}
                type="button"
                data-canvas-layer={node.id}
                aria-pressed={active}
                onClick={() => {
                  setSelection([node.id]);
                  setNodes((current) => bringToFront(current, node.id));
                }}
                className={`flex items-center gap-2 rounded px-2 py-1 text-left transition ${
                  active
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-black"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <span className="truncate">{node.label ?? node.type}</span>
                <span className="ml-auto shrink-0 opacity-60">
                  {NODE_TYPE_LABEL[node.type]}
                </span>
              </button>
            );
          })}
      </aside>

      {/* 画布 */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={surfaceRef}
          data-canvas-surface
          role="application"
          aria-label="无限画布"
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onSurfacePointerMove}
          onPointerUp={onSurfacePointerUp}
          onPointerCancel={onSurfacePointerUp}
          onWheel={onWheel}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer?.files?.[0];
            if (file) ingestImageFile(file, toCanvas(event));
          }}
          className={`relative h-full w-full touch-none overflow-hidden rounded-xl border border-gray-200 ${
            spaceDown || tool !== "select" ? "cursor-grab" : "cursor-default"
          } dark:border-gray-800`}
          style={gridStyle}
        >
          {sortByZ(nodes).map((node) => {
            const screen = canvasToScreen(viewport, { x: node.x, y: node.y });
            const active = selection.includes(node.id);
            return (
              <div
                key={node.id}
                data-canvas-node={node.id}
                onPointerDown={(event) => onNodePointerDown(event, node)}
                className={`absolute select-none rounded-lg border text-xs ${
                  active
                    ? "border-blue-500 shadow-lg"
                    : "border-gray-300 dark:border-gray-600"
                } ${
                  node.type === "frame"
                    ? "bg-transparent"
                    : "bg-white/95 dark:bg-gray-900/95"
                }`}
                style={{
                  left: screen.x,
                  top: screen.y,
                  width: node.width * viewport.scale,
                  height: node.height * viewport.scale,
                  zIndex: node.zIndex,
                }}
              >
                <span className="pointer-events-none absolute left-1 top-0.5 text-[10px] text-gray-400">
                  {node.label ?? NODE_TYPE_LABEL[node.type]}
                </span>
                {/* 图片节点要真的把图画出来 —— 否则「结果落回画布」只能看出一只空框 */}
                {node.src ? (
                  // 画布内图片：来源是用户本机图片或生成结果，非远端资源
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    data-canvas-node-image={node.id}
                    src={node.src}
                    alt={node.label ?? "画布图片"}
                    draggable={false}
                    className="h-full w-full rounded-lg object-cover"
                  />
                ) : node.text ? (
                  <p className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2 pt-4 text-[10px] leading-tight text-gray-600 dark:text-gray-300">
                    {node.text}
                  </p>
                ) : null}
              </div>
            );
          })}

          {/* 选框 */}
          {marqueeRect && (
            <div
              data-canvas-marquee
              className="pointer-events-none absolute border border-blue-500 bg-blue-500/10"
              style={{
                left: canvasToScreen(viewport, marqueeRect).x,
                top: canvasToScreen(viewport, marqueeRect).y,
                width: marqueeRect.width * viewport.scale,
                height: marqueeRect.height * viewport.scale,
              }}
            />
          )}

          {/* 选中包围盒 + 缩放手柄（单选用） */}
          {box && (
            <div
              data-canvas-selection
              className="pointer-events-none absolute border border-blue-500"
              style={{
                left: canvasToScreen(viewport, box).x,
                top: canvasToScreen(viewport, box).y,
                width: box.width * viewport.scale,
                height: box.height * viewport.scale,
              }}
            >
              {selectedNode &&
                RESIZE_HANDLES.map((handle) => {
                  const position: Record<ResizeHandle, string> = {
                    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
                    n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
                    ne: "left-full top-0 -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
                    e: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
                    se: "left-full top-full -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
                    s: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
                    sw: "left-0 top-full -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
                    w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
                  };
                  return (
                    <span
                      key={handle}
                      data-canvas-handle={handle}
                      onPointerDown={(event) => onHandlePointerDown(event, handle)}
                      className={`pointer-events-auto absolute h-2 w-2 rounded-sm border border-blue-500 bg-white ${position[handle]}`}
                    />
                  );
                })}
            </div>
          )}
        </div>

        {/* W31：选区上方的 ComfyUI Inpaint 浮条 */}
        {selectedNode && box && (
          <div
            data-canvas-inpaint-bar
            className="absolute z-[60] flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/95 p-2 text-xs text-white shadow-xl backdrop-blur"
            style={{
              left: canvasToScreen(viewport, { x: box.x, y: box.y }).x,
              top: Math.max(
                8,
                canvasToScreen(viewport, { x: box.x, y: box.y }).y - 46,
              ),
            }}
          >
            <input
              data-canvas-inpaint-prompt
              value={promptText}
              disabled={isGenerating}
              onChange={(event) => setPromptText(event.target.value)}
              placeholder="输入 AI 重绘 / 生成 Prompt…"
              className="w-52 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100 outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              data-canvas-inpaint-submit
              onClick={() => void handleInpaintSubmit()}
              disabled={
                isGenerating || promptText.trim() === "" || !canInpaint(selectedNode)
              }
              className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1 text-xs font-medium transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {isGenerating
                ? comfyState === "reconnecting"
                  ? "重连中…"
                  : comfyState === "connected"
                    ? "生成中…"
                    : "连接中…"
                : "✨ ComfyUI Inpaint"}
            </button>
            {isGenerating && progress !== null && (
              <span
                data-canvas-inpaint-progress
                className="tabular-nums text-gray-300"
              >
                {progress}%
              </span>
            )}
            {!canInpaint(selectedNode) && !isGenerating && (
              <span className="text-[11px] text-amber-300">
                只有带图片的节点能重绘
              </span>
            )}
            {genError && (
              <span
                data-canvas-inpaint-error
                title={genError}
                className="max-w-56 truncate text-[11px] text-red-300"
              >
                {genError}
              </span>
            )}
          </div>
        )}

        {/* 悬浮工具栏 */}
        <div
          data-canvas-toolbar
          role="toolbar"
          aria-label="画布工具"
          className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-full border border-gray-200 bg-white/95 px-2 py-1 text-xs shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95"
        >
          {CANVAS_TOOLS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-canvas-tool={item.key}
              aria-pressed={tool === item.key}
              onClick={() => setTool(item.key)}
              title={item.hint}
              className={`rounded-full px-2.5 py-1 transition ${
                tool === item.key
                  ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-black"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {item.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
          <button
            type="button"
            data-canvas-zoom-out
            aria-label="缩小"
            onClick={() => zoomByStep(1 / ZOOM_STEP)}
            className="rounded-full px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            −
          </button>
          <span
            data-canvas-zoom
            className="min-w-10 text-center tabular-nums text-gray-500 dark:text-gray-400"
          >
            {formatZoom(viewport.scale)}
          </span>
          <button
            type="button"
            data-canvas-zoom-in
            aria-label="放大"
            onClick={() => zoomByStep(ZOOM_STEP)}
            className="rounded-full px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            ＋
          </button>
          <button
            type="button"
            data-canvas-fit
            onClick={fitContent}
            className="rounded-full px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            适应内容
          </button>
          <button
            type="button"
            data-canvas-reset
            onClick={resetViewportState}
            className="rounded-full px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            重置
          </button>
        </div>
      </div>

      {/* 属性面板 */}
      <aside
        data-canvas-properties
        className="flex w-48 shrink-0 flex-col gap-2 overflow-auto rounded-xl border border-gray-200 p-2 text-xs dark:border-gray-800"
      >
        <span className="px-1 font-medium text-gray-500 dark:text-gray-400">属性</span>
        {!selectedNode ? (
          <p data-canvas-properties-empty className="px-1 text-gray-400">
            选中一个元素以调节属性（Shift 加选，拖空白框选）
          </p>
        ) : (
          <>
            <p className="px-1 text-gray-500 dark:text-gray-400">
              {selectedNode.label ?? NODE_TYPE_LABEL[selectedNode.type]}
            </p>
            {(
              [
                ["x", "X"],
                ["y", "Y"],
                ["width", "宽"],
                ["height", "高"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 px-1">
                <span className="w-6 text-gray-400">{label}</span>
                <input
                  type="number"
                  data-canvas-prop={key}
                  value={Math.round(selectedNode[key])}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    setNodes((current) =>
                      updateNode(current, selectedNode.id, {
                        [key]:
                          key === "width" || key === "height"
                            ? Math.max(MIN_NODE_SIZE, value)
                            : value,
                      }),
                    );
                  }}
                  className="w-full rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
            ))}
            {selectedNode.type === "prompt" && (
              <label className="flex flex-col gap-1 px-1">
                <span className="text-gray-400">Prompt</span>
                <textarea
                  data-canvas-prompt-text
                  rows={3}
                  value={selectedNode.text ?? ""}
                  onChange={(event) =>
                    setNodes((current) =>
                      updateNode(current, selectedNode.id, { text: event.target.value }),
                    )
                  }
                  className="w-full rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
            )}
            <div className="flex gap-1 px-1">
              <button
                type="button"
                data-canvas-action="front"
                onClick={() =>
                  setNodes((current) => bringToFront(current, selectedNode.id))
                }
                className="rounded border border-gray-300 px-2 py-0.5 dark:border-gray-700"
              >
                置顶
              </button>
              <button
                type="button"
                data-canvas-action="back"
                onClick={() =>
                  setNodes((current) => sendToBack(current, selectedNode.id))
                }
                className="rounded border border-gray-300 px-2 py-0.5 dark:border-gray-700"
              >
                置底
              </button>
            </div>
            <button
              type="button"
              data-canvas-action="delete"
              onClick={() => {
                setNodes((current) => removeNodes(current, [selectedNode.id]));
                setSelection([]);
              }}
              className="mx-1 rounded border border-red-300 px-2 py-0.5 text-red-600 dark:border-red-900 dark:text-red-400"
            >
              删除
            </button>
          </>
        )}
        <p className="mt-auto px-1 text-[11px] leading-relaxed text-gray-400">
          Space/中键拖拽平移 · Ctrl+滚轮缩放 · 选中后拖手柄拉伸
        </p>
        <label className="flex flex-col gap-1 px-1">
          <span className="text-gray-400">ComfyUI 服务地址</span>
          <input
            data-canvas-comfy-url
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-[11px] dark:border-gray-700 dark:bg-gray-950"
          />
        </label>
      </aside>
    </div>
  );
}
