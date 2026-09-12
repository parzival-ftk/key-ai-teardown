import { evidenceLabelText } from "@/lib/report/evidence-labels";
import type { Evidence, EvidenceLabel } from "@/lib/types/evidence";

const EVIDENCE_CLASS: Record<EvidenceLabel, string> = {
  verified: "text-green-600 dark:text-green-400",
  inferred: "text-amber-600 dark:text-amber-400",
  missing: "text-gray-400",
};

/** 异常/缺失 label 的兜底样式（与 evidenceLabelText 的「未知」配套） */
const UNKNOWN_CLASS = "text-gray-400";

/**
 * 样式查找同样要兜底：历史数据里的异常 label 若直接索引会得到 undefined，
 * 拼进模板字符串会渲染出 `class="… undefined"`。
 */
function classFor(label: unknown): string {
  return typeof label === "string" && label in EVIDENCE_CLASS
    ? EVIDENCE_CLASS[label as EvidenceLabel]
    : UNKNOWN_CLASS;
}

/**
 * 证据标签列表（W2 建立；W3 支持展开）。
 * 直播视图（analyze-view）与报告视图（report-view）共用，避免两处渲染漂移。
 *
 * 交互（W3）：默认只显示 `[标签] 结论`；带来源的结论可点击展开，看到 `来源：…`。
 * 用原生 <details> 实现——无需 JS 状态，SSR 与客户端行为一致。无证据时不渲染。
 *
 * 健壮性（审查修复）：文案与样式都经安全查找兜底，reading 自 localStorage 的
 * 历史数据即便 label 异常也不会渲染出 `[undefined]` / `class="… undefined"`。
 */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1 border-t border-gray-100 pt-3 dark:border-gray-800">
      {evidence.map((item, i) => (
        <li key={`${item.label}-${i}`} className="flex gap-2 text-xs">
          <span className={`shrink-0 font-medium ${classFor(item.label)}`}>
            [{evidenceLabelText(item.label)}]
          </span>
          {item.source ? (
            <details className="min-w-0">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                {item.claim}
              </summary>
              <p className="mt-1 text-gray-400">来源：{item.source}</p>
            </details>
          ) : (
            <span className="text-gray-500">{item.claim}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
