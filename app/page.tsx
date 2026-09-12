import { getLLMConfigStatus, PROVIDER_PRESETS } from "@/lib/config";
import { ConnectionTest } from "@/components/connection-test";

// 每次请求读取真实环境变量（构建时无 key，不应被静态快照）
export const dynamic = "force-dynamic";

export default function Home() {
  const status = getLLMConfigStatus();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-tight">Key</h1>
        <p className="text-lg text-gray-500">
          AI 产品拆解助手 —— 把任何产品拆成关键洞察
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
        <h2 className="mb-3 font-semibold">LLM 配置</h2>

        {status.configured ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">Base URL</dt>
            <dd className="break-all">{status.baseURL}</dd>
            <dt className="text-gray-500">模型</dt>
            <dd>{status.model}</dd>
          </dl>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-amber-600">
              尚未配置 LLM。请复制 <code>.env.example</code> 为{" "}
              <code>.env</code>，填入你持有的一家厂商 key。
            </p>
            <p className="text-gray-500">
              缺失项：{status.missing.join("、")}
            </p>
            <p className="text-gray-500">
              支持厂商：{Object.keys(PROVIDER_PRESETS).join(" / ")}
            </p>
          </div>
        )}

        <div className="mt-4">
          <ConnectionTest />
        </div>
      </section>
    </main>
  );
}
