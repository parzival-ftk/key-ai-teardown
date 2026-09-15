/**
 * DAG 拓扑配置（W13）—— **客户端安全**：零重依赖，不 import 任何 Agent/框架/编排模块。
 *
 * 为什么是「静态数据 + 防漂移测试」而不是运行时从 `createDefaultAgents()` 推导：
 * 运行推导会把整个 `lib/frameworks` 提示词库打进客户端 bundle（本视图在直播页，代价不可接受）；
 * 纯静态又有漂移风险。解法是两者结合 —— 静态数据在这里，`dagConfig.test.ts` 用**真实编队**
 * （经 `resolveDependencies` / `planLayers` / `transitiveReduction`）逐项断言 id / name / layer /
 * dependsOn / edges，编队一改测试立刻红。
 *
 * 数据来源：由真实编队一次性导出（见提交说明），非人工臆测。
 * 拓扑形态：**6 层** —— 5 个分析 Agent 并行 → 访谈官 → 质疑官 → 答辩官 → 综合官 → PRD。
 * 串行 Agent 依赖「全部前序」，故各占一层；`DAG_EDGES` 已做传递归约（31 条原始边 → 9 条骨干边）。
 */

export interface DagNodeConfig {
  id: string;
  /** 展示名 */
  name: string;
  /** Inspector 的「Prompt 简报」：该角色的职责一句话（UI 文案） */
  brief: string;
  /** 所在层（0 起） */
  layer: number;
  /** 原始依赖（全部前序）—— 供 Inspector 展示原貌，不做归约 */
  dependsOn: string[];
}

export interface DagEdgeConfig {
  from: string;
  to: string;
}

export interface DagConfig {
  nodes: DagNodeConfig[];
  /** 绘制用边（传递归约后的骨干边，保留可达性） */
  edges: DagEdgeConfig[];
  /** 每层的 node id（层内并行） */
  layers: string[][];
  layerCount: number;
}

/**
 * 编队声明顺序（`createDefaultAgents()` 的数组顺序）——**串行 Agent 隐式依赖的顺序基准**。
 * 用一张顺序表派生依赖，而不是手工拼接，避免顺序错位（顺序会影响 priorResults 的排列）。
 */
const FLEET_ORDER = [
  "market",
  "user-research",
  "interviewer",
  "business",
  "visual-design",
  "ui-code",
  "devils-advocate",
  "rebuttal",
  "synthesis",
  "prd",
];

/** 并行组：无依赖，同层并发 */
const PARALLEL_IDS = ["market", "user-research", "business", "visual-design", "ui-code"];

export const DAG_LAYERS: string[][] = [
  [...PARALLEL_IDS],
  ["interviewer"],
  ["devils-advocate"],
  ["rebuttal"],
  ["synthesis"],
  ["prd"],
];

/** 每层的语义标签（UI 文案，与 DAG_LAYERS 一一对应） */
export const DAG_LAYER_LABELS = [
  "并行分析",
  "访谈",
  "质疑",
  "答辩",
  "裁决",
  "PRD",
] as const;

/** 某 Agent「之前声明的全部 Agent」（按编队顺序）——串行 Agent 的隐式依赖 */
const priorTo = (id: string): string[] =>
  FLEET_ORDER.slice(0, FLEET_ORDER.indexOf(id));

/** 原始依赖（全部前序）——与编排层实际调度逐项一致（由防漂移测试钉住） */
const RAW_DEPENDENCIES: Record<string, string[]> = {
  market: [],
  "user-research": [],
  business: [],
  "visual-design": [],
  "ui-code": [],
  // 访谈官是唯一显式声明依赖的 Agent（只依赖研究员画像）
  interviewer: ["user-research"],
  "devils-advocate": priorTo("devils-advocate"),
  rebuttal: priorTo("rebuttal"),
  synthesis: priorTo("synthesis"),
  prd: priorTo("prd"),
};

const NODE_META: Record<string, { name: string; brief: string }> = {
  market: { name: "竞品分析师", brief: "竞品格局、竞争壁垒与威胁等级" },
  "user-research": { name: "用户研究员", brief: "用户画像、JTBD 与核心场景" },
  business: { name: "商业模式分析师", brief: "商业模式画布与增长漏斗" },
  "visual-design": { name: "视觉设计分析师", brief: "拆解界面视觉设计语言" },
  "ui-code": { name: "界面代码生成师", brief: "还原为 HTML + Tailwind 代码起点" },
  interviewer: { name: "用户访谈官", brief: "以研究员画像模拟用户访谈" },
  "devils-advocate": { name: "反方质疑官", brief: "挑战前序分析的关键假设" },
  rebuttal: { name: "答辩官", brief: "逐条答辩：接受 / 反驳 / 存疑" },
  synthesis: { name: "PM 综合官", brief: "裁决分歧并收敛结论" },
  prd: { name: "PRD 撰写官", brief: "产出可直接开发的 PRD" },
};

/** 绘制用边：传递归约后的骨干边（保留可达性，去掉冗余扇入） */
export const DAG_EDGES: DagEdgeConfig[] = [
  { from: "user-research", to: "interviewer" },
  { from: "market", to: "devils-advocate" },
  { from: "interviewer", to: "devils-advocate" },
  { from: "business", to: "devils-advocate" },
  { from: "visual-design", to: "devils-advocate" },
  { from: "ui-code", to: "devils-advocate" },
  { from: "devils-advocate", to: "rebuttal" },
  { from: "rebuttal", to: "synthesis" },
  { from: "synthesis", to: "prd" },
];

const LAYER_OF: Record<string, number> = {};
DAG_LAYERS.forEach((layer, index) => {
  for (const id of layer) LAYER_OF[id] = index;
});

function buildConfig(): DagConfig {
  const nodes: DagNodeConfig[] = [];
  for (const layer of DAG_LAYERS) {
    for (const id of layer) {
      const meta = NODE_META[id];
      if (!meta) throw new Error(`DAG 配置缺少节点元信息：${id}`);
      nodes.push({
        id,
        name: meta.name,
        brief: meta.brief,
        layer: LAYER_OF[id],
        dependsOn: RAW_DEPENDENCIES[id] ?? [],
      });
    }
  }
  return {
    nodes,
    edges: DAG_EDGES,
    layers: DAG_LAYERS,
    layerCount: DAG_LAYERS.length,
  };
}

export const DAG_CONFIG: DagConfig = buildConfig();

/** 全部节点 id（按层顺序） */
export const DAG_NODE_IDS: string[] = DAG_CONFIG.nodes.map((n) => n.id);

/** 按 id 取节点 */
export const DAG_NODE_BY_ID: Record<string, DagNodeConfig> = Object.fromEntries(
  DAG_CONFIG.nodes.map((n) => [n.id, n]),
);
