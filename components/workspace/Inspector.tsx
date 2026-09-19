"use client";

import type { CapabilitySource, ComponentTree, GeneratedAsset } from "@/lib/components/types";
import { componentBreadcrumb, componentFields } from "@/lib/components/inspector-fields";
import { componentPrompt } from "@/lib/components/prompt";

/**
 * 组件 Inspector（阶段 15，spec §11–§14）。
 *
 * 纯展示组件：所有状态与副作用由工作区持有，这里只负责把「选中组件的信息 +
 * 可执行的生成动作」渲染出来。展示数据来自 `inspector-fields` / `prompt`（纯函数）。
 *
 * 生成路径：Prompt → Generate Visual → ImageGeneration Service → ComfyUIProvider。
 * 本组件不接触任何后端细节，只发出 `onGenerate(componentId)`。
 */

export interface InspectorProps {
  tree: ComponentTree;
  /** 当前选中的组件 id；null 表示未选中 */
  componentId: string | null;
  /** 全部生成资产（组件树共享） */
  assets: readonly GeneratedAsset[];
  /** 生成进行中 */
  generating: boolean;
  /** 生成中显示的状态文案 */
  generatingLabel?: string;
  /** 结构化错误文案 */
  error?: string | null;
  /** 能否生成（缺 Prompt / 生成中时为否） */
  canGenerate: boolean;
  /** 截图分析的能力来源（决定是否显示 DEMO 标记） */
  analysisSource?: CapabilitySource;
  /** 复制 Prompt 后的短暂反馈 */
  copied?: boolean;
  onPromptChange?: (componentId: string, prompt: string) => void;
  onGenerate?: (componentId: string) => void;
  onCopyPrompt?: (prompt: string) => void;
  onRegenerate?: (componentId: string) => void;
  onOpenAsset?: (asset: GeneratedAsset) => void;
  onUseAsset?: (asset: GeneratedAsset) => void;
}

export function Inspector({
  tree,
  componentId,
  assets,
  generating,
  generatingLabel = "Generating…",
  error,
  canGenerate,
  analysisSource,
  copied,
  onPromptChange,
  onGenerate,
  onCopyPrompt,
  onRegenerate,
  onOpenAsset,
  onUseAsset,
}: InspectorProps) {
  const node = componentId ? tree.nodes[componentId] : undefined;

  if (!node || !componentId) {
    return (
      <aside
        data-inspector
        className="flex w-72 shrink-0 flex-col gap-2 overflow-auto rounded-xl border border-gray-200 p-3 text-xs dark:border-gray-800"
      >
        <span className="font-medium text-gray-500 dark:text-gray-400">Inspector</span>
        <p data-inspector-empty className="text-gray-400">
          选中一个组件以查看属性、Prompt 与生成入口。
        </p>
      </aside>
    );
  }

  const fields = componentFields(node);
  const breadcrumb = componentBreadcrumb(tree, componentId);
  const prompt = componentPrompt(tree, componentId);
  const componentAssets = assets.filter((asset) => asset.componentId === componentId);

  return (
    <aside
      data-inspector
      className="flex w-72 shrink-0 flex-col gap-3 overflow-auto rounded-xl border border-gray-200 p-3 text-xs dark:border-gray-800"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-500 dark:text-gray-400">Inspector</span>
        {analysisSource === "demo" && (
          <span
            data-inspector-demo-badge
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            DEMO 分析
          </span>
        )}
      </div>

      <p data-inspector-breadcrumb className="truncate text-[11px] text-gray-400">
        {breadcrumb.join(" / ")}
      </p>

      <dl className="flex flex-col gap-1.5">
        {fields.map((field) => (
          <div key={field.key} className="flex gap-2">
            <dt className="w-20 shrink-0 text-gray-400">{field.label}</dt>
            <dd
              data-inspector-field={field.key}
              className="min-w-0 flex-1 break-words text-gray-700 dark:text-gray-200"
            >
              {field.value || <span className="text-gray-300 dark:text-gray-600">—</span>}
            </dd>
          </div>
        ))}
      </dl>

      <label className="flex flex-col gap-1">
        <span className="text-gray-400">Prompt</span>
        <textarea
          data-inspector-prompt
          rows={4}
          value={prompt}
          onChange={(event) => onPromptChange?.(componentId, event.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1 leading-snug dark:border-gray-700 dark:bg-gray-950"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-inspector-copy-prompt
          onClick={() => onCopyPrompt?.(prompt)}
          className="rounded border border-gray-300 px-2 py-1 dark:border-gray-700"
        >
          {copied ? "已复制" : "Copy Prompt"}
        </button>
        <button
          type="button"
          data-inspector-generate
          disabled={!canGenerate || generating}
          onClick={() => onGenerate?.(componentId)}
          className="rounded bg-indigo-600 px-3 py-1 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? generatingLabel : "Generate Visual"}
        </button>
      </div>

      {generating && (
        <p data-inspector-generating className="text-indigo-400">
          {generatingLabel}
        </p>
      )}

      {error && (
        <p
          data-inspector-error
          className="rounded border border-red-300 bg-red-50 p-2 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {componentAssets.length > 0 && (
        <section data-inspector-assets className="flex flex-col gap-2">
          <span className="text-gray-400">Generated Asset</span>
          {componentAssets.map((asset) => (
            <div
              key={asset.id}
              data-inspector-asset={asset.id}
              className="flex flex-col gap-1 rounded border border-gray-200 p-1.5 dark:border-gray-800"
            >
              {asset.url ? (
                // 生成资产缩略图：来源是 ComfyUI 直链
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-inspector-asset-thumb={asset.id}
                  src={asset.url}
                  alt={asset.prompt}
                  className="h-24 w-full rounded object-cover"
                />
              ) : (
                <span className="text-[10px] text-gray-400">（无可用图片）</span>
              )}
              <span className="truncate text-[10px] text-gray-500">{asset.prompt}</span>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  data-inspector-regenerate
                  onClick={() => onRegenerate?.(componentId)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  data-inspector-open-asset
                  onClick={() => onOpenAsset?.(asset)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700"
                >
                  Open
                </button>
                <button
                  type="button"
                  data-inspector-use-asset
                  onClick={() => onUseAsset?.(asset)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700"
                >
                  Use as Asset
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
