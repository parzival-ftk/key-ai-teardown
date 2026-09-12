import Link from "next/link";
import { CompareForm } from "@/components/compare-form";
import { getLLMConfigStatus, PROVIDER_PRESETS } from "@/lib/config";
import { ConnectionTest } from "@/components/connection-test";

// 每次请求读取真实环境变量（构建时无 key，不应被静态快照）
export const dynamic = "force-dynamic";

export default function ComparePage() {
  const status = getLLMConfigStatus();
  const supportedVendors = Object.entries(PROVIDER_PRESETS)
    .map(([key, preset]) => `${key}（${preset.model}）`)
    .join(" / ");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-gray-400 hover:underline">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">多产品对比</h1>
        <p className="text-lg text-gray-500">
          输入 2-3 个产品，各自独立拆解后产出并列对比表
        </p>
        <Link
          href="/compare/sample"
          className="text-sm text-gray-400 hover:underline"
        >
          查看样例对比 →
        </Link>
      </header>

      {!status.configured && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            尚未配置 LLM
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-400">
            请复制 <code>.env.example</code> 为 <code>.env</code>，填入你持有的一家厂商
            key。缺失项：{status.missing.join("、")}
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-400">
            支持厂商：{supportedVendors}
          </p>
          <div className="mt-3">
            <ConnectionTest />
          </div>
        </div>
      )}

      <CompareForm />
    </main>
  );
}
