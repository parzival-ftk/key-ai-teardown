import { describe, it, expect } from "vitest";
import {
  parseUserStories,
  buildIssues,
  userStoryToIssue,
  issuesToMarkdown,
  issuesToJson,
  type UserStory,
} from "./github-issues";

const SAMPLE_PRD = `## 二、用户故事与验收标准

- As a 新用户, I want 在 30 秒内完成引导, so that 我能快速看到产品价值。
  - [ ] Given 首次登录 When 进入首页 Then 显示 3 步引导
- As a 团队管理员, I want 邀请成员加入工作区, so that 协作更顺畅。
  - [ ] Given 已创建工作区 When 点击「邀请」Then 生成邀请链接
  - [ ] Given 成员点击链接 When 登录 Then 自动加入工作区

## 三、功能范围
（略）`;

describe("PRD → GitHub Issues（Wave 5.3）", () => {
  it("userStoryToIssue 生成含用户故事与验收 checklist 的 issue", () => {
    const story: UserStory = {
      title: "引导流程",
      role: "新用户",
      capability: "30 秒完成引导",
      benefit: "快速看到价值",
      acceptance: ["Given A When B Then C"],
    };
    const issue = userStoryToIssue(story, ["prd", "ux"]);
    expect(issue.title).toBe("引导流程");
    expect(issue.body).toContain("As a **新用户**");
    expect(issue.body).toContain("- [ ] Given A When B Then C");
    expect(issue.labels).toEqual(["prd", "ux"]);
  });

  it("验收标准为空时给出占位项", () => {
    const issue = userStoryToIssue({
      title: "t",
      role: "r",
      capability: "c",
      benefit: "b",
      acceptance: [],
    });
    expect(issue.body).toContain("（待补充）");
  });

  it("parseUserStories 从 PRD 文本抽取 2 条用户故事及验收标准", () => {
    const stories = parseUserStories(SAMPLE_PRD);
    expect(stories).toHaveLength(2);
    expect(stories[0].role).toBe("新用户");
    expect(stories[0].capability).toContain("30 秒内完成引导");
    expect(stories[0].benefit).toBe("我能快速看到产品价值");
    expect(stories[0].acceptance).toHaveLength(1);
    expect(stories[1].role).toBe("团队管理员");
    expect(stories[1].acceptance).toHaveLength(2);
  });

  it("parseUserStories 抽不到时返回空数组（不抛错）", () => {
    expect(parseUserStories("这是一段没有用户故事的普通文本。")).toEqual([]);
    expect(parseUserStories("")).toEqual([]);
  });

  it("buildIssues → issuesToMarkdown 含标题与标签", () => {
    const issues = buildIssues(parseUserStories(SAMPLE_PRD), ["prd"]);
    expect(issues).toHaveLength(2);
    const md = issuesToMarkdown(issues);
    expect(md).toContain("## 1.");
    expect(md).toContain("`prd`");
    expect(md).toContain("验收标准");
  });

  it("issuesToMarkdown 空列表给出明确说明", () => {
    expect(issuesToMarkdown([])).toContain("未解析出用户故事");
  });

  it("issuesToJson 产出合法 JSON 且含 issues 数组", () => {
    const issues = buildIssues(parseUserStories(SAMPLE_PRD));
    const parsed = JSON.parse(issuesToJson(issues)) as {
      issues: { title: string }[];
    };
    expect(parsed.issues).toHaveLength(2);
    expect(typeof parsed.issues[0].title).toBe("string");
  });
});
