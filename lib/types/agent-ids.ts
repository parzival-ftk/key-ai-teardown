/**
 * 跨层共享的 Agent id 常量（单一事实来源）。
 *
 * 为什么单独放这里：Agent id 既被 agents 层（各 Agent 工厂）使用，也被 frameworks 层
 * （如访谈官框架要按 agentId 筛出研究员画像）引用。若 frameworks 层直接硬编码字面量，
 * 上游 id 一旦漂移，访谈官会**静默**走软降级、无任何报错——这里建立编译期绑定来消除该风险。
 * 本模块零依赖，任何层引用它都不会形成循环依赖。
 */

/** 用户研究员 Agent id（对应 lib/agents/user-research.ts） */
export const USER_RESEARCH_AGENT_ID = "user-research";
