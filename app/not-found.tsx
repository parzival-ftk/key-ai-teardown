import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">404</h1>
      <p className="text-sm text-gray-500">
        找不到你要访问的页面。它可能已被删除，或链接有误。
      </p>
      <Link
        href="/"
        className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
      >
        返回首页
      </Link>
    </main>
  );
}
