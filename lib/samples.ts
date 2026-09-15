import { USER_RESEARCH_AGENT_ID } from "@/lib/types/agent-ids";
import type { Evidence } from "@/lib/types/evidence";
import {
  parseReasoningTrace,
  type ReasoningStep,
} from "@/lib/agents/reasoning-parser";

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
  /** W15：PRD 声明回应的质疑 id（样例为示意值） */
  addressedCriticIds?: string[];
  /** W16：竞品维度打分（样例为示意值） */
  dimensionScores?: Record<string, number>;
}

export interface SampleReport {
  name: string;
  sections: SampleReportSection[];
  /** W22：样例「Agent 推理过程」步骤（供报告页时间轴演示） */
  reasoningTrace?: ReasoningStep[];
}

export const SAMPLE_REPORT_NAME = "Notion（样例）";

const SECTIONS: SampleReportSection[] = [
  {
    agentId: "market",
    name: "竞品分析师",
    status: "done",
    confidence: 72,
    // W16：维度打分（样例示意值）——供报告页的雷达图
    dimensionScores: {
      ux: 88,
      monetization: 74,
      tech_barrier: 82,
      jtbd_fit: 86,
      growth: 70,
      risk: 58,
    },
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
    agentId: USER_RESEARCH_AGENT_ID,
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
C1.（来自竞品分析师）「block 模型壁垒高」——但模板可复制，壁垒可能被生态抹平。
C2.（来自用户研究员）「掌控感是核心情绪价值」——也可能是『工具焦虑』的来源。
C3.（来自商业模式分析师）中文市场的社区与模板供给能否跟上，缺乏供给侧数据。

### 反驳点
- 如果失败，最可能因为：**太灵活导致用户不知道从哪开始**，被更「开箱即用」的垂直工具切走。

### 必须回答的问题
1. 新用户 5 分钟内能否产出第一个有用页面？
2. 中文市场的社区与模板能否跟上？
3. 团队版的价格锚点相对飞书是否成立？`,
  },
  {
    agentId: "rebuttal",
    name: "答辩官",
    status: "done",
    confidence: 63,
    evidence: [
      { claim: "「官方模板不构成壁垒」的判断由机制推演得出", label: "inferred" },
      {
        claim: "Notion 官方已提供场景模板与新手引导入口",
        label: "verified",
        source: "notion.so 官网",
      },
      { claim: "5 分钟首个有用页面的实际达成率无公开数据", label: "missing" },
    ],
    output: `### 逐条答辩
1. **质疑**：「block 模型壁垒高」——但模板可复制，壁垒可能被生态抹平。
   - **答辩**：部分接受。官方模板确实易被复制，但**用户自建并沉淀的结构化内容**才是个体切换成本的主要来源，这部分难以被复制。壁垒应从「模板生态」修正为「数据模型 + 沉淀内容」。
   - **结论**：修正（改变原结论的措辞）。
2. **质疑**：「掌控感」也可能是工具焦虑的来源。
   - **答辩**：接受。高度自由这一设计同时带来掌控感与选择过载，二者是同一变量的两面，此前分析只讲了正面。
   - **结论**：修正 —— 「掌控感」需拆成「掌控感（正）」与「选择过载（负）」两面。

### 修正后的结论
- 「block 模型是高壁垒」→ 修正为「数据模型 + 用户沉淀内容构成壁垒，官方模板不构成壁垒」。

### 仍存分歧
- 中文市场「社区与本地化模板能否跟上」缺乏供给侧数据，当前信息无法裁决，标注待验证。`,
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
    // W15：声明本 PRD 回应了哪些质疑（与正文里的 [C1]/[C2] 标记一致；C3 未回应）
    addressedCriticIds: ["C1", "C2"],
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
- 中文模板内容供给是依赖项，可能拖慢冷启动节奏。
- 「灵活 = 壁垒」是双刃剑：过度引导会损害高级用户自由度。[C1][C2]

### 六、发布就绪清单
- [文档] PRD 与验收标准已评审 —— 待办
- [数据] 埋点与成功指标已接入 —— 待办
- [体验] 新手引导与空状态已就绪 —— 待办
- [稳定性] 错误态与降级路径已覆盖 —— 已满足（流式失败不阻塞）

### 七、核心用户流程（flowchart）

\`\`\`mermaid
flowchart TD
  A[新用户进入] --> B{选择场景模板}
  B -->|有合适模板| C[一键生成含示例数据的工作区]
  B -->|没有| D[从空白页开始]
  C --> E[5 分钟内产出第一个有用页面]
  D --> E
  E --> F{是否邀请成员}
  F -->|是| G[分配角色与权限]
  F -->|否| H[个人继续使用]
  G --> I[团队协作沉淀]
  H --> I
\`\`\`

### 八、工作区状态流转（state diagram）

\`\`\`mermaid
stateDiagram-v2
  [*] --> 空工作区
  空工作区 --> 已选模板: 选择场景模板
  已选模板 --> 有内容: 生成示例页面
  空工作区 --> 有内容: 手动创建页面
  有内容 --> 已邀请成员: 发送邀请
  已邀请成员 --> 协作中: 成员接受并继承权限
  协作中 --> [*]: 归档
\`\`\``,
  },
  {
    agentId: "ui-code",
    name: "界面代码生成师",
    status: "done",
    confidence: 62,
    evidence: [
      { claim: "结构还原基于截图中的区块划分推断", label: "inferred" },
      {
        claim: "配色使用通用色阶，未取用品牌色",
        label: "verified",
        source: "notion.so 界面截图",
      },
      { claim: "精确间距与字号需按设计规范校正", label: "missing" },
    ],
    output: `按「侧栏 + 主内容 + 顶栏」三段结构还原，交互元素用 Tailwind 通用色阶表达；
品牌色与图标以中性占位替代 —— 这是**参考起点**，请据此自行设计。

\`\`\`html
<div class="flex h-screen bg-white text-slate-800">
  <aside class="w-60 shrink-0 border-r border-slate-200 p-4">
    <div class="mb-4 flex items-center gap-2">
      <span class="h-6 w-6 rounded bg-slate-300"></span>
      <span class="text-sm font-semibold">Workspace</span>
    </div>
    <nav class="flex flex-col gap-1 text-sm text-slate-600">
      <a class="rounded px-2 py-1 hover:bg-slate-100">Getting Started</a>
      <a class="rounded px-2 py-1 hover:bg-slate-100">Projects</a>
      <a class="rounded px-2 py-1 hover:bg-slate-100">Templates</a>
    </nav>
  </aside>
  <main class="flex min-w-0 flex-1 flex-col">
    <header class="flex items-center justify-between border-b border-slate-200 px-6 py-3">
      <h1 class="text-lg font-semibold">Projects</h1>
      <button class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">New</button>
    </header>
    <section class="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
      <article class="rounded-lg border border-slate-200 p-4">
        <h2 class="text-sm font-medium">Project A</h2>
        <p class="mt-1 text-xs text-slate-500">Lorem ipsum dolor sit amet.</p>
      </article>
      <article class="rounded-lg border border-slate-200 p-4">
        <h2 class="text-sm font-medium">Project B</h2>
        <p class="mt-1 text-xs text-slate-500">Lorem ipsum dolor sit amet.</p>
      </article>
    </section>
  </main>
</div>
\`\`\``,
  },
];

/**
 * W22：样例推理日志（ReAct 风格：Thought / Action / Observation）——
 * 经 parseReasoningTrace 提炼成结构化步骤，让 `/sample` 无需 LLM 也能演示
 * 报告页的「Agent 推理过程」时间轴（含耗时统计与按 Agent 筛选）。
 */
const SAMPLE_REASONING_LOG = [
  "MarketAgent:",
  "Thought: 先把可比较的维度定下来，**没有统一心智就没有对比**。",
  'Action: scan_competitors("协作与文档工具")',
  "Observation: 识别到 4 个直接竞品，耗时 1.1s",
  "",
  "UserResearchAgent:",
  "Thought: 结论：三类用户可按协作深度聚类，而非团队规模。",
  "Observation: 产出 3 个用户画像，耗时 0.8s",
  "",
  "PrdAgent:",
  "Thought: **每条用户故事都要挂回一条质疑**，否则 PRD 无法自证。",
  'Action: draft_prd("模板中心")',
  "Observation: 生成 5 条用户故事与验收标准，耗时 1.2s",
  "",
  "RebuttalAgent:",
  "Thought: 结论：模板生态可能是伪壁垒，供给成本被低估。",
].join("\n");

export const SAMPLE_REPORT: SampleReport = {
  name: SAMPLE_REPORT_NAME,
  sections: SECTIONS,
  reasoningTrace: parseReasoningTrace(SAMPLE_REASONING_LOG),
};

/**
 * 内置对比样例（W11）—— 无 API key / 断网时演示「多产品并列对比表」。
 * 内容为示意（对三个公开产品的定位级对比），非实时模型产出；证据标签同为示意。
 */
export interface SampleComparison {
  products: string[];
  /** W16：每个产品的维度打分（与 products 同序）——供对比页雷达图 */
  dimensionScores?: Array<Record<string, number>>;
  comparison: {
    output: string;
    confidence?: number;
    evidence: Evidence[];
  };
}

export const SAMPLE_COMPARISON: SampleComparison = {
  products: ["Notion", "Figma", "Duolingo"],
  // W16：三产品维度打分（样例示意值）——雷达图三个系列
  dimensionScores: [
    { ux: 88, monetization: 74, tech_barrier: 82, jtbd_fit: 86, growth: 70, risk: 58 },
    { ux: 94, monetization: 80, tech_barrier: 68, jtbd_fit: 90, growth: 84, risk: 66 },
    { ux: 80, monetization: 62, tech_barrier: 42, jtbd_fit: 72, growth: 95, risk: 54 },
  ],
  comparison: {
    confidence: 66,
    evidence: [
      { claim: "三者定位差异由各自公开定位归纳", label: "inferred" },
      {
        claim: "Notion 以公开页面 / 模板做 PLG 传播",
        label: "verified",
        source: "notion.so 公开页面功能",
      },
      { claim: "三者收入结构的具体数值均未公开", label: "missing" },
    ],
    output: `### 一句话定位
- **Notion**：给团队与个人的一体化工作空间，把文档、数据库与看板合一。
- **Figma**：浏览器端的协同设计工具，让设计资产变成可实时协作的在线对象。
- **Duolingo**：游戏化语言学习应用，用打卡与排行榜驱动每日学习习惯。

### 并列对比表

| 对比维度 | Notion | Figma | Duolingo |
| --- | --- | --- | --- |
| 目标用户 / 核心场景 | 中小团队与个人知识管理 | 产品 / 设计团队协作 | 语言学习个人用户 |
| 核心价值主张 | 一个工具替代文档 + 表格 + 看板 | 多人实时共编同一设计文件 | 把「坚持学」游戏化 |
| 商业模式 | 个人免费 + 团队按席位订阅 | 按席位订阅（编辑者收费） | 免费 + 订阅 / 广告 |
| 主要竞争优势 | block 数据模型 + 沉淀内容 | 实时协同 + 设计-开发交接 | 动机设计（streak / 排行榜） |
| 主要风险 / 软肋 | 太灵活、新手上手门槛高 | 依赖浏览器性能 | 高阶用户易流失到系统课程 |

### 关键差异
1. **沉淀物不同**：Notion 沉淀「内容」，Figma 沉淀「设计资产」，Duolingo 沉淀「学习行为」。
2. **壁垒来源不同**：前两者靠用户自建内容 / 文件的切换成本，Duolingo 靠行为习惯（streak）。
3. **付费锚点不同**：Notion / Figma 是团队席位，Duolingo 是个人订阅。

### 选择建议
- 要做**团队知识管理** → Notion。
- 要做**多人设计协作** → Figma。
- 目标用户是**需要被激励的个人** → 参考 Duolingo 的动机设计。

> 以上为示例对比（示意内容），非实时模型产出。`,
  },
};
