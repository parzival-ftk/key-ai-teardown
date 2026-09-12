#!/usr/bin/env node
/**
 * 演示冒烟脚本（W12）—— 校验「演示路径」上的关键端点是否可达。
 *
 * 用法：先 `npm run dev`，再 `npm run demo`（或 `node scripts/demo-smoke.mjs`）。
 * 端口可用 BASE_URL 覆盖，例如：BASE_URL=http://localhost:3001 npm run demo
 *
 * 注意：/api/health 在「未配置 LLM」时会返回 400 —— 那是端点可达的正常结果，
 * 本脚本把 2xx–4xx 都视为「可达」（演示路径的关键是页面/接口在，而非业务成功）。
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const CHECKS = [
  { path: "/", note: "首页（输入表单 + 主线 + 样例入口）" },
  { path: "/sample", note: "样例报告（无 Key 演示）" },
  { path: "/compare", note: "多产品对比输入" },
  { path: "/compare/sample", note: "样例对比（无 Key 演示）" },
  { path: "/api/health", note: "连通性探针（未配置 LLM 时返回 400 属预期）" },
];

async function check({ path, note }) {
  const url = BASE + path;
  try {
    const res = await fetch(url, { redirect: "manual" });
    return {
      path,
      note,
      status: res.status,
      ok: res.status >= 200 && res.status < 500,
    };
  } catch (err) {
    return {
      path,
      note,
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

const results = [];
for (const c of CHECKS) results.push(await check(c));

let failed = 0;
console.log(`[demo] 冒烟校验 ${BASE}`);
for (const r of results) {
  if (r.ok) {
    console.log(`  [OK]   ${r.path.padEnd(18)} HTTP ${r.status}  ${r.note}`);
  } else {
    failed += 1;
    console.log(
      `  [FAIL] ${r.path.padEnd(18)} ${r.error ?? `HTTP ${r.status}`}  ${r.note}`,
    );
  }
}

if (failed > 0) {
  console.error(
    `\n[demo] ${failed} 项失败。确认 dev server 已启动（npm run dev），或用 BASE_URL 指定地址。`,
  );
  process.exit(1);
}
console.log("\n[demo] 全部通过 —— 演示路径可用。详见 docs/demo.md");
