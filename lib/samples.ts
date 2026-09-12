import type { Evidence } from "@/lib/types/evidence";

/**
 * 内置样例报告（Wave 6.3；W2 补可信度层）—— 断网 / 无 API key 时也能完整演示。
 * 内容为演示用途（对已知产品 Notion 的示意性拆解），非实时模型产出；
 * 证据标签同为示意，用于展示「可追溯」这一能力。
 */

export interface SampleReportSection {
  agentId: string;
  name: string;
  status: string;
  output: string;
  /** 模型自评置信度（样例为示意值） */
  confidence?: number;
  /** 证据标签（样例为示意值） */
  evidence: Evidence[];
}

export interface SampleReport {
  name: string;
  sections: SampleReportSection[];
}

export const SAMPLE_REPORT_NAME = "Notion（样例）";

const SECTIONS: SampleReportSection[] = [
  {
    agentId: "market",
    name: "竞品分析师",
    status: "done",
    confidence: 72,
    evidence: [
      {
        claim: "Notion 提供文档、数据库与看板三类核心能力",
        label: "verified",
        source: "notion.so 官网",
      },
      { claim: "block 数据模型 + 模板生态构成核心壁垒", label: "inferred" },
      {
        claim: "中文企业市场的合规与本地化门槛未在公开资料中确认",
        label: "missing",
      },
    ],
    output: `### 竞争格局
Notion 处在「一体化工作空间」赛道，主要竞争者分三类：
1. **文档协作为主**：Coda、飞书文档 —— 强在文档，弱在数据库灵活性。
2. **项目管理为主**：ClickUp、Asana —— 强在流程，弱在知识沉淀。
3. **笔记为主**：Obsidian、Roam —— 强在个人知识，弱在团队协作。

### 威胁等级
- **飞书 / 钉钉（威胁等级：高）**：生态捆绑 + 本地化，中文市场渗透强。
- **ClickUp（威胁等级：中）**：功能全但体验重，易劝退轻量用户。
- **Obsidian（威胁等级：低）**：定位个人、开源生态，正面冲突小。

### 壁垒
核心壁垒是 **block 数据模型 + 模板生态**：切换成本来自用户自建的结构化内容，而非功能本身。
（推测）中文企业市场的合规与本地化能力是主要短板。`,
  },
  {
    agentId: "user-research",
    name: "用户研究员",
    status: "done",
    confidence: 68,
    evidence: [
      { claim: "三类用户画像按行为聚类推断得出", label: "inferred" },
      {
        claim: "「掌控感」是官方模板与营销中的核心诉求",
        label: "verified",
        source: "notion.so 官网",
      },
      { claim: "中文本地化模板与社区内容的实际供给量未知", label: "missing" },
    ],
    output: `### 用户画像（按行为聚类）
1. **「知识管家」型**：个人为主，把 Notion 当第二大脑，重检索与模板。
2. **「流程搭建者」型**：小团队负责人，用数据库搭轻量项目系统。
3. **「内容发布者」型**：用 Notion 做公开站点 / 作品集。

### JTBD
- functional：把零散信息结构化，一处更新、处处复用。
- emotional：在混乱的信息中有「掌控感」，不必再切换十几个工具。
- social：对外呈现专业、有组织的形象。

### 未满足需求
- 中文本地化的模板与社区内容偏少；
- 复杂数据库的关系视图学习曲线陡。`,
  },
  {
    agentId: "interviewer",
    name: "用户访谈官",
    status: "done",
    confidence: 55,
    evidence: [
      { claim: "无真实访谈数据，persona 与证言均为模拟", label: "missing" },
      { claim: "「过度整理」摩擦点由社区讨论归纳", label: "inferred" },
    ],
    output: `> 以下 persona 与证言为**模拟**，非真实访谈数据；persona 沿用「用户研究员」确立的画像。

### Persona 1｜「知识管家」型（独立顾问）
「我拿它管客户和项目，一个页面搞定。可模板太多反而看花了眼，我常常陷入『整理工具』本身，正事没干。」（摩擦点：过度整理；潜台词：想要更少的默认模板）

### Persona 2｜「流程搭建者」型（创业团队负责人）
「想让全组用，但导入和权限配置太折腾，最后只有我和另一个人在用。」（摩擦点：协作入门门槛高）

### Persona 3｜「内容发布者」型（独立设计师）
「我把作品集挂在 Notion 上，好看是好看，但访客总说加载慢。」（摩擦点：公开页性能；潜台词：怕影响专业形象）

### 最普遍的 3 个抱怨
1. 太灵活，缺乏「最佳实践」引导；2. 移动端体验弱；3. 页面加载偶尔慢。
### 最打动人的 1 个卖点
一个工具同时替代文档 + 表格 + 看板。`,
  },
  {
    agentId: "visual-design",
    name: "视觉设计分析师",
    status: "done",
    confidence: 64,
    evidence: [
      { claim: "界面以低饱和中性色 + 少量强调色为主", label: "inferred" },
      {
        claim: "官方设计说明中公开了色板与字体层级",
        label: "verified",
        source: "notion.so 设计说明",
      },
      { claim: "具体品牌字体名未在公开页面确证", label: "missing" },
    ],
    output: `### 色板
主色为近黑中性色（用于正文与主按钮），背景近白，强调色为低饱和暖橙 / 蓝，整体克制。
（推测）强调色随模板主题变化，未固定为单一品牌色。

### 字体层级
- 标题：较大字号 + 稍粗字重；正文：常规字重、行高宽松（约 1.6–1.8）。
- 辅助文字：小字号 + 灰色，用于元信息与时间戳。

### 间距节奏
区块留白充足，卡片内边距统一；整体偏「宽松阅读型」，而非「高密度信息型」。

### 组件类型清单
按钮（主 / 次 / 文本三档）、卡片、数据库表格、侧边导航、标签（tag）、页面引用块。

### 布局模式
侧边栏（页面树）+ 主内容区 + 顶部工具栏；部分场景切换为全宽阅读态。

> 以上为设计语言的**参考起点**，用于理解与借鉴，请自行设计，勿直接照搬。`,
  },
  {
    agentId: "business",
    name: "商业模式分析师",
    status: "done",
    confidence: 66,
    evidence: [
      { claim: "self-serve 模式使 CAC 偏低", label: "inferred" },
      { claim: "LTV 取决于团队席位扩张速度", label: "inferred" },
      { claim: "具体转化率与净留存 NRR 数值未公开", label: "missing" },
    ],
    output: `### 商业模式画布（要点）
- 收入结构：个人免费 + 团队按席位订阅（个人 Pro / 团队版）。
- 增长引擎：**PLG**——用公开页面 / 模板做病毒传播，再转团队付费。
- 关键成本：研发 + 基础设施，边际成本低。

### 单位经济学（(推测) 行业区间）
- 由于 self-serve，CAC 偏低；LTV 取决于团队席位扩张速度。
- 护栏指标：免费 → 付费转化率、席位净留存（NRR）。`,
  },
  {
    agentId: "devils-advocate",
    name: "反方质疑官",
    status: "done",
    confidence: 60,
    evidence: [
      { claim: "「block 壁垒高」可能被模板生态抹平", label: "inferred" },
      { claim: "缺少与竞品的模板库规模对比数据", label: "missing" },
    ],
    output: `### 被质疑的假设
1.（来自竞品分析师）「block 模型壁垒高」——但模板可复制，壁垒可能被生态抹平。
2.（来自用户研究员）「掌控感是核心情绪价值」——也可能是『工具焦虑』的来源。

### 反驳点
- 如果失败，最可能因为：**太灵活导致用户不知道从哪开始**，被更「开箱即用」的垂直工具切走。

### 必须回答的问题
1. 新用户 5 分钟内能否产出第一个有用页面？
2. 中文市场的社区与模板能否跟上？
3. 团队版的价格锚点相对飞书是否成立？`,
  },
  {
    agentId: "synthesis",
    name: "PM 综合官",
    status: "done",
    confidence: 75,
    evidence: [
      { claim: "核心壁垒是数据模型 + 模板生态", label: "inferred" },
      {
        claim: "PLG 增长路径已被公开页面传播实践验证",
        label: "verified",
        source: "notion.so 公开页面功能",
      },
      { claim: "中文市场是增长短板，本地化与合规为变量", label: "inferred" },
    ],
    output: `### 执行摘要
Notion 的机会在「一体化 + 结构化」，最大风险是「过度灵活劝退新用户」，且中文市场受本土生态挤压。

### 收敛结论
- 核心壁垒是数据模型 + 模板生态 —— 置信度：中（模板可复制，需靠网络效应维持）。
- PLG 增长路径成立 —— 置信度：高（公开页面传播已被验证）。
- 中文市场是增长短板 —— 置信度：中（本地化与合规是变量）。

### 分歧清单
反方质疑官认为「灵活=壁垒」可能是双刃剑，我倾向认可：壁垒与阻力同源。

### 下一步建议
1. 强化新手引导与默认模板；
2. 补齐中文模板与社区；
3. 优化团队版的邀请与权限体验。`,
  },
  {
    agentId: "prd",
    name: "PRD 撰写官",
    status: "done",
    confidence: 70,
    evidence: [
      { claim: "北极星指标「5 分钟内容创建率」为建议值", label: "inferred" },
      {
        claim: "埋点与成功指标尚未接入，指标口径待定",
        label: "missing",
      },
      { claim: "用户故事基于前述画像与摩擦点推导", label: "inferred" },
    ],
    output: `### 一、背景与目标
降低新用户从注册到产出第一个有用页面的门槛，把「5 分钟做出第一个页面」作为体验目标。

### 二、用户故事与验收标准
- As a 新用户, I want 选择场景模板一键开始, so that 我不用面对空白页。
  - [ ] Given 首次登录 When 选择「项目管理」场景 Then 自动生成含示例数据的模板页
- As a 团队负责人, I want 一键邀请成员并分配权限, so that 团队能快速上手。
  - [ ] Given 已创建工作区 When 输入邮箱邀请 Then 成员登录后自动进入并继承角色权限

### 三、功能范围
MVP：场景模板库 + 新手引导 + 团队邀请。明确不做：高级权限矩阵、企业 SSO。

### 四、成功指标
北极星：新用户 5 分钟内容创建率。护栏：邀请转化率、次日留存。

### 五、风险与依赖
中文模板内容供给是依赖项；过度引导可能损害高级用户自由度。

### 六、发布就绪清单
- [文档] PRD 与验收标准已评审 —— 待办
- [数据] 埋点与成功指标已接入 —— 待办
- [体验] 新手引导与空状态已就绪 —— 待办
- [稳定性] 错误态与降级路径已覆盖 —— 已满足（流式失败不阻塞）`,
  },
];

export const SAMPLE_REPORT: SampleReport = {
  name: SAMPLE_REPORT_NAME,
  sections: SECTIONS,
};
