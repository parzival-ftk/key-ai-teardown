import Link from "next/link";
import { HistoryList } from "@/components/history-list";

export default function HistoryPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回首页
        </Link>
        <h1 className="text-2xl font-bold">历史记录</h1>
        <p className="text-sm text-gray-400">
          本地保存（不上传服务器），最多保留最近 50 次分析。
        </p>
      </header>
      <HistoryList />
    </main>
  );
}
