/**
 * PRD → GitHub Issues（Wave 5.3）—— 借鉴 E5（jetrich/prdy、groff.dev 的 PRD→Issues）。
 * 把 PRD 中的用户故事转成可导入 GitHub 的 issue（含验收标准 checklist）。
 */

export interface UserStory {
  /** 一句话标题 */
  title: string;
  role: string;
  capability: string;
  benefit: string;
  /** 验收标准（Given-When-Then 文本行） */
  acceptance: string[];
}

export interface GitHubIssue {
  title: string;
  body: string;
  labels: string[];
}

export const DEFAULT_LABELS = ["prd"];
const MAX_TITLE_LEN = 60;

function shorten(text: string, max = MAX_TITLE_LEN): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** 单条用户故事 → issue（标题 + 用户故事 + 验收标准 checklist） */
export function userStoryToIssue(
  story: UserStory,
  labels: string[] = DEFAULT_LABELS,
): GitHubIssue {
  const body = [
    "## 用户故事",
    `As a **${story.role}**, I want **${story.capability}**, so that **${story.benefit}**.`,
    "",
    "## 验收标准",
    story.acceptance.length
      ? story.acceptance.map((a) => `- [ ] ${a}`).join("\n")
      : "- [ ] （待补充）",
  ].join("\n");
  return { title: story.title, body, labels: [...labels] };
}

export function buildIssues(
  stories: UserStory[],
  labels: string[] = DEFAULT_LABELS,
): GitHubIssue[] {
  return stories.map((s) => userStoryToIssue(s, labels));
}

/** issue 列表 → Markdown（可直接贴进 GitHub，或配合 gh 批量创建） */
export function issuesToMarkdown(issues: GitHubIssue[]): string {
  if (issues.length === 0) return "# PRD Issues\n\n（未解析出用户故事）";
  return issues
    .map((issue, i) => {
      const labels = issue.labels.length
        ? `\n\n标签：${issue.labels.map((l) => `\`${l}\``).join(" ")}`
        : "";
      return `## ${i + 1}. ${issue.title}${labels}\n\n${issue.body}`;
    })
    .join("\n\n---\n\n");
}

export function issuesToJson(issues: GitHubIssue[]): string {
  return JSON.stringify({ issues }, null, 2);
}

/** 用户故事的正则：As a <role>, I want <capability>, so that <benefit> */
const STORY_RE =
  /as an?\s+([^,，]+?)\s*[,，]?\s*i want\s+([^,，]+?)\s*[,，]?\s*so that\s+(.+?)(?:[.。]|$)/i;
const CHECKBOX_RE = /^\s*[-*]\s*\[[ xX]\]\s*(.+)$/;
const GWT_RE = /^\s*(?:Given|When|Then|And)\b(.+)$/i;

/**
 * best-effort：从 PRD 文本抽取用户故事。
 * LLM 输出格式不完全可预测，故抽取不到时返回空数组（由调用方降级），不抛错。
 */
export function parseUserStories(prdText: string): UserStory[] {
  const stories: UserStory[] = [];
  let current: UserStory | null = null;

  for (const line of prdText.split(/\r?\n/)) {
    const m = STORY_RE.exec(line);
    if (m) {
      if (current) stories.push(current);
      current = {
        title: shorten(m[2].trim()),
        role: m[1].trim(),
        capability: m[2].trim(),
        benefit: m[3].trim().replace(/[.。]$/, ""),
        acceptance: [],
      };
      continue;
    }
    if (current) {
      const acc = CHECKBOX_RE.exec(line) ?? GWT_RE.exec(line);
      if (acc) current.acceptance.push(acc[1].trim());
    }
  }
  if (current) stories.push(current);
  return stories;
}
