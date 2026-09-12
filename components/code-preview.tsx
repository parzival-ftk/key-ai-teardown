"use client";

import { useEffect, useState } from "react";
import { buildPreviewDoc } from "@/lib/report/preview-doc";

/**
 * 界面代码的只读预览（W7 降级版）。
 *
 * 用 `sandbox=""` 的 iframe 渲染代码：**不执行任何脚本**（LLM 产出不落地为可执行内容）。
 * 样式靠把父页面的样式表 href 注入 srcdoc —— 项目 Tailwind 是按需子集，故对源码出现过
 * 的类名（含内置样例）精确，对运行时全新类名会退化为无样式，属已知限制。
 *
 * 完整可编辑画布（选中元素 / 改属性即时反映）因本环境无浏览器通道、无法验证，
 * 未实现 —— 见 W7 交付说明。
 */
export function CodePreview({ html }: { html: string }) {
  const [cssHref, setCssHref] = useState("");

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"]',
    );
    setCssHref(link?.href ?? "");
  }, []);

  if (!html.trim()) return null;

  return (
    <div className="mt-3">
      <div className="mb-1 text-xs text-gray-400">预览（只读）</div>
      <iframe
        title="界面代码预览（只读）"
        className="h-80 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-800"
        sandbox=""
        srcDoc={buildPreviewDoc(html, cssHref)}
      />
    </div>
  );
}
