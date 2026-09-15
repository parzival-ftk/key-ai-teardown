/**
 * Mermaid 渲染编排（W15）。
 *
 * 把「渲染」与「组件」分开：渲染是可注入的纯异步函数，因此
 * **成功 / 失败两条分支都能在 Node 里单测**（不必引 jsdom 或真跑 mermaid）。
 * 组件的 effect 只负责调用它并把结果放进 state。
 *
 * 安全：mermaid 以 `securityLevel: "strict"` 初始化（标签做净化，禁用脚本/事件），
 * 并关掉 `htmlLabels` —— 图谱源码来自 LLM，属于不可信输入，不能让标签里的 HTML 生效。
 */

export type MermaidRenderer = (code: string, id: string) => Promise<string>;

export interface RenderOutcome {
  svg?: string;
  error?: string;
}

/**
 * 默认渲染器：**动态 import** mermaid（只在浏览器执行；SSR 永不触达）。
 * 每次渲染前 initialize，保证配置不被其它调用点改掉。
 */
export async function defaultMermaidRenderer(
  code: string,
  id: string,
): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    // 图谱源码来自 LLM —— 按不可信输入处理
    securityLevel: "strict",
    // 不把错误 SVG 注入真实 DOM（失败由我们自己的降级 UI 呈现）
    suppressErrorRendering: true,
    theme: "neutral",
    flowchart: { htmlLabels: false },
  });
  const { svg } = await mermaid.render(id, code);
  return svg;
}

/** 渲染 mermaid 源码 → SVG 字符串；失败返回 error（不抛错，交给降级 UI） */
export async function renderMermaidSvg(
  code: string,
  id: string,
  renderer: MermaidRenderer = defaultMermaidRenderer,
): Promise<RenderOutcome> {
  if (!code.trim()) return { error: "图谱源码为空" };
  try {
    const svg = await renderer(code, id);
    if (!svg || !svg.trim()) return { error: "渲染结果为空" };
    return { svg };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Mermaid 渲染失败（语法可能不合法）",
    };
  }
}
