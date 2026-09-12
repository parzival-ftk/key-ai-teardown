import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * ESLint flat config（Next.js 16 / ESLint 9）。
 *
 * 为什么直接展开 flat 数组、不用 FlatCompat：
 * 旧写法 `compat.extends("next/core-web-vitals", "next/typescript")` 在
 * ESLint 9 + eslint-config-next 16 下会在**配置加载阶段**抛
 * `TypeError: Converting circular structure to JSON`，导致 `npm run lint`
 * 完全不可用（尚未开始扫描任何文件就崩）。eslint-config-next 16 已原生导出
 * flat config（`./core-web-vitals`、`./typescript`），直接展开即可。
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // react-hooks v6 新增的编译期建议规则。本项目 5 处命中是同一模式：挂载时读取
      // 浏览器端外部存储 / DOM（sessionStorage、localStorage、document 里的 stylesheet
      // 链接）后再 setState。改为 useState 惰性初始化会造成服务端首帧与客户端不一致
      // （hydration mismatch）——对 SSR 应用，正确解法是 useSyncExternalStore 级别的重构。
      // 这里保留为 warn：信号可见、不阻塞 lint 门禁，重构单独跟踪。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // 全局忽略：构建产物 + 工具产物（.rivet 下是 agent 的备份/快照，非项目源码）
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      ".rivet/**",
    ],
  },
];

export default eslintConfig;
