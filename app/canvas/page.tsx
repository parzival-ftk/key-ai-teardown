import Link from "next/link";
import { CanvasViewport } from "@/components/canvas/CanvasViewport";

/**
 * 无限画布（W29）—— Figma 式画布底座的演示页。
 * 零外部画布依赖：视口数学与几何操作都是 `lib/canvas` 下的纯函数。
 */

export const metadata = {
  title: "无限画布 · Key",
  description: "Figma 式无限画布：平移缩放、图层拖拽与拉伸、多选包围盒。",
};

export default function CanvasPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-8">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">无限画布</h1>
        <p className="text-sm text-gray-500">
          平移缩放 · 图层拖拽与拉伸 · 单选/多选包围盒 —— 全部基于原生 Pointer
          Events，未引入任何画布或图形框架。
        </p>
      </header>

      <CanvasViewport />
    </main>
  );
}
