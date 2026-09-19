"use client";

import type { ComponentNode, ComponentTree } from "@/lib/components/types";
import { COMPONENT_TYPE_LABEL } from "@/lib/components/inspector-fields";
import { childrenOf, rootNode } from "@/lib/components/tree";

/**
 * 组件树面板（阶段 15，spec §6/§7）。
 *
 * 展示 Page → Section → Component → Element 的层级，点击选中组件（与画布选择联动）。
 * 纯展示：选择状态由工作区持有。
 */

export interface ComponentTreePanelProps {
  tree: ComponentTree;
  selection: readonly string[];
  onSelect: (id: string) => void;
}

export function ComponentTreePanel({ tree, selection, onSelect }: ComponentTreePanelProps) {
  const root = rootNode(tree);
  return (
    <aside
      data-component-tree
      className="flex max-h-[40vh] min-h-24 flex-col gap-1 overflow-auto rounded-xl border border-gray-200 p-2 text-xs dark:border-gray-800"
    >
      <span className="px-1 font-medium text-gray-500 dark:text-gray-400">组件树</span>
      {!root ? (
        <p data-component-tree-empty className="px-1 text-gray-400">
          还没有结构。上传截图并 Analyze，或新建项目。
        </p>
      ) : (
        <TreeRow node={root} depth={0} tree={tree} selection={selection} onSelect={onSelect} />
      )}
    </aside>
  );
}

function TreeRow({
  node,
  depth,
  tree,
  selection,
  onSelect,
}: {
  node: ComponentNode;
  depth: number;
  tree: ComponentTree;
  selection: readonly string[];
  onSelect: (id: string) => void;
}) {
  const active = selection.includes(node.id);
  return (
    <div>
      <button
        type="button"
        data-tree-node={node.id}
        data-depth={depth}
        aria-pressed={active}
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        className={`flex w-full items-center gap-2 rounded py-1 pr-2 text-left transition ${
          active
            ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-black"
            : "hover:bg-gray-100 dark:hover:bg-gray-800"
        }`}
      >
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 text-[10px] opacity-60">
          {COMPONENT_TYPE_LABEL[node.type]}
        </span>
      </button>
      {childrenOf(tree, node.id).map((child) => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          tree={tree}
          selection={selection}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
