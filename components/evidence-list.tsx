import { EVIDENCE_LABEL } from "@/lib/report/evidence-labels";
import type { Evidence, EvidenceLabel } from "@/lib/types/evidence";

const EVIDENCE_CLASS: Record<EvidenceLabel, string> = {
  verified: "text-green-600 dark:text-green-400",
  inferred: "text-amber-600 dark:text-amber-400",
  missing: "text-gray-400",
};

/**
 * 证据标签列表（W2）—— 直播视图（analyze-view）与报告视图（report-view）共用，
 * 避免两处渲染各写一份而漂移。无证据时不渲染任何内容。
 */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1 border-t border-gray-100 pt-3 dark:border-gray-800">
      {evidence.map((item, i) => (
        <li key={i} className="flex gap-2 text-xs">
          <span
            className={`shrink-0 font-medium ${EVIDENCE_CLASS[item.label]}`}
          >
            [{EVIDENCE_LABEL[item.label]}]
          </span>
          <span className="text-gray-500">
            {item.claim}
            {item.source ? `（${item.source}）` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
