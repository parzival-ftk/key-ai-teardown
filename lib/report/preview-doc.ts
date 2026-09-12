/**
 * 只读预览文档构造（W7 降级版）。
 *
 * 背景（W7 探针发现）：
 *  - iframe srcdoc 是独立文档，不继承父页面样式，必须显式引入 CSS；
 *  - 项目自己的 Tailwind 产物是**按需子集**（只含源码扫描到的类，实测 24KB/272 条规则），
 *    LLM 运行时新生成的类名不会在其中 —— 所以预览对「源码出现过的类」（含内置样例）精确，
 *    对全新类名会降级为无样式。这是已知限制：选择「离线可用 + 不执行脚本」优先于
 *    「覆盖全 + 依赖 Tailwind CDN」。
 *  - 刻意不注入任何 <script>：只读预览不执行 LLM 产出的代码（与 iframe sandbox="" 配套）。
 */

/**
 * 剥掉 HTML 里的 <script>（不信任输入的兜底）。
 * 预览容器用 sandbox="allow-same-origin"（元素选中需要同源访问 DOM），此时若 srcdoc 里带
 * LLM 产出的脚本，脚本将能触达父页面 —— 故必须净化。框架本就要求「不带 JS 逻辑」。
 */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "");
}

export function buildPreviewDoc(bodyHtml: string, cssHref: string): string {
  const safeBody = stripScripts(bodyHtml);
  const link = cssHref ? `<link rel="stylesheet" href="${cssHref}">` : "";
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    link,
    "<style>html,body{margin:0;padding:0}</style>",
    "</head>",
    `<body>${safeBody}</body>`,
    "</html>",
  ].join("");
}
