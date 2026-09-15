/**
 * 质疑 → PRD 追溯（W15，纯函数）。
 *
 * 数据关联靠**显式 id 标记**，不靠语义猜测：
 * - 反方质疑官：每条质疑以 `C1.` / `C2.` 开头（见 lib/frameworks/devils-advocate.ts 的契约）
 * - PRD 撰写官：在回应某条质疑的段落里写 `[C1]` 标记，并在元数据里给出 `addressed_critic_ids`
 *
 * 解析对格式宽容（粗体、列表符号、全角冒号都能认），但对**语义**不猜 —— 没标记就是没关联。
 */

export interface CriticItem {
  /** 规范化 id（大写，如 "C1"） */
  id: string;
  /** 该条质疑的正文（已去掉编号前缀） */
  text: string;
}

export interface PrdReference {
  criticId: string;
  /** 引用所在行（供展示上下文） */
  line: string;
}

export interface TraceabilityLink {
  criticId: string;
  criticText: string;
  /** PRD 是否回应了这条质疑 */
  addressed: boolean;
  /** PRD 中引用它的位置 */
  references: PrdReference[];
}

export interface TraceabilityReport {
  links: TraceabilityLink[];
  total: number;
  addressed: number;
  /** 未被回应的质疑 id */
  unaddressed: string[];
  /** PRD 引用了但不存在的质疑 id（悬空引用，属于契约错误） */
  danglingReferences: string[];
}

/** 行首编号：容忍列表符号 / 粗体 / 全角分隔符 */
const CRITIC_LINE =
  /^\s*(?:[-*+]\s*|\d+[.)]\s*)?\*{0,2}\[?(C\d+)\]?\*{0,2}\s*[.、:：)）]\s*(.+)$/i;

/** 正文中的 PRD 引用标记 */
const PRD_REFERENCE = /\[(C\d+)\]/gi;

const normalizeId = (raw: string) => raw.toUpperCase();

/** 从质疑正文里解析出编号条目（行首编号才算，正文中提及不算） */
export function extractCriticItems(criticText: string): CriticItem[] {
  const items: CriticItem[] = [];
  const seen = new Set<string>();
  for (const line of criticText.split(/\r?\n/)) {
    const match = CRITIC_LINE.exec(line);
    if (!match) continue;
    const id = normalizeId(match[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, text: (match[2] ?? "").trim() });
  }
  return items;
}

/** 从 PRD 正文里解析出 `[Cn]` 引用标记（按行记录上下文） */
export function extractPrdReferences(prdText: string): PrdReference[] {
  const refs: PrdReference[] = [];
  for (const line of prdText.split(/\r?\n/)) {
    for (const match of line.matchAll(PRD_REFERENCE)) {
      refs.push({ criticId: normalizeId(match[1]), line: line.trim() });
    }
  }
  return refs;
}

/**
 * 建立追溯关系。
 *
 * @param addressedFromMetadata 元数据 `addressed_critic_ids`（老/新契约兼容；
 *   即便正文里漏了 `[Cn]` 标记，只要元数据声明了也算已回应）
 */
export function buildTraceability(
  criticText: string,
  prdText: string,
  addressedFromMetadata: string[] = [],
): TraceabilityReport {
  const items = extractCriticItems(criticText);
  const references = extractPrdReferences(prdText);
  const declared = new Set(addressedFromMetadata.map(normalizeId));

  const links: TraceabilityLink[] = items.map((item) => {
    const own = references.filter((r) => r.criticId === item.id);
    return {
      criticId: item.id,
      criticText: item.text,
      addressed: own.length > 0 || declared.has(item.id),
      references: own,
    };
  });

  const known = new Set(items.map((i) => i.id));
  const danglingReferences = [
    ...new Set(references.map((r) => r.criticId).filter((id) => !known.has(id))),
  ];

  return {
    links,
    total: links.length,
    addressed: links.filter((l) => l.addressed).length,
    unaddressed: links.filter((l) => !l.addressed).map((l) => l.criticId),
    danglingReferences,
  };
}

/* ── DOM 锚点：供「双向高亮跳转」使用（report-view 与测试共用同一套规则） ── */

export const criticAnchorId = (criticId: string) =>
  `critic-${normalizeId(criticId).toLowerCase()}`;

export const prdAnchorId = (criticId: string) =>
  `prd-ref-${normalizeId(criticId).toLowerCase()}`;
