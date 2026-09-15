import Link from "next/link";
import { ResourceNav } from "@/components/resources/ResourceNav";
import { ResourceExtendPanel } from "@/components/resources/ResourceExtendPanel";
import {
  collectTags,
  countResources,
  loadResourceDataset,
} from "@/lib/resources/ui-resources";

/**
 * UI 资源库（W28）—— 把内置的外部 UI 资源数据源变成可交互工具。
 * 需求 §5「界面代码」只给起点，这里提供的是**素材库**：拆解界面时可在此找参考范式。
 * 数据全部来自 `lib/resources/ui-resources.json`（无网络请求、无第三方脚本）。
 */

export const metadata = {
  title: "UI 资源库 · Key",
  description: "精选外部 UI 资源与视觉范式，供产品拆解时参考。",
};

export default function ResourcesPage() {
  const dataset = loadResourceDataset();
  const existingIds = dataset.flatMap((group) =>
    group.items.map((item) => item.id),
  );

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">UI 资源库</h1>
        <p className="text-sm text-gray-500">
          {dataset.length} 个分类 · {countResources(dataset)} 个外部 UI 资源 ——
          拆解界面与撰写 PRD 时的参考工具箱。
        </p>
      </header>

      <ResourceNav dataset={dataset} />
      <ResourceExtendPanel
        existingIds={existingIds}
        existingTags={collectTags(dataset)}
      />
    </main>
  );
}
