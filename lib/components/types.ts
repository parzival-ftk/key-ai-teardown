/**
 * 组件树数据模型（阶段 15）。
 *
 * 这是「界面分析 → 结构化拆解」的中间表示：AI 分析产出的结构化 JSON 先归一到这棵树，
 * 再由上层映射成画布节点。**绝不把 AI 的原始 JSON 直接当画布 state** —— 画布状态是
 * `lib\canvas\canvas-node` 的 `CanvasNode`，本模块只描述「界面由哪些组件构成、彼此什么关系」。
 *
 * 与其他领域模型（`lib\types\*`）同一条纪律：纯数据结构 + zod schema 做边界校验，
 * 不含任何 UI 或网络细节。
 */

/** 结构层级（MVP 只保留四级） */
export type ComponentType = "page" | "section" | "component" | "element";

export const COMPONENT_TYPES: readonly ComponentType[] = [
  "page",
  "section",
  "component",
  "element",
];

/** 组件在原始界面中的矩形（像素坐标；缺省布局时 width/height 为 0 表示「待布局」） */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 组件的可读属性（Inspector 展示 / Prompt 生成的素材） */
export interface ComponentProperties {
  /** 语义角色，如 "search input" / "primary button" */
  role?: string;
  /** 组件内的文案（按钮文字、标题等） */
  text?: string;
  /** 视觉风格描述，如 "rounded, subtle shadow, blue accent" */
  style?: string;
  /** 面向生成模型的视觉描述（自然语言） */
  visualDescription?: string;
}

export interface ComponentNode {
  id: string;
  type: ComponentType;
  name: string;
  description?: string;
  rect: Rect;
  /** 父组件 id（根节点无此字段） */
  parentId?: string;
  /** 子组件 id 列表（顺序即界面顺序） */
  children: string[];
  properties?: ComponentProperties;
  /** 该组件专属的生成提示词（缺省时由 `componentPrompt` 推导） */
  prompt?: string;
}

/** 组件树：扁平字典 + 根 id。扁平结构便于 O(1) 查找、序列化与局部更新。 */
export interface ComponentTree {
  rootId: string;
  nodes: Record<string, ComponentNode>;
}

/** 能力来源标记 —— 用于如实区分 REAL / DEMO / MOCK，绝不假装 */
export type CapabilitySource = "real" | "demo" | "mock";

/** 一次生成产出的视觉资产，绑定到来源组件 */
export interface GeneratedAsset {
  id: string;
  /** 来源组件 id —— 可追溯「这张图属于哪个组件」 */
  componentId: string;
  /** provider 标识，如 "comfyui" */
  provider: string;
  /** 实际使用的提示词 */
  prompt: string;
  /** 落盘路径 */
  artifactPath: string;
  /** 可取回该图的 URL（后端直链，用于在画布展示） */
  url?: string;
  width: number;
  height: number;
  /** ISO 时间戳 */
  createdAt: string;
}

/** 项目来源：内置示例 / 用户上传截图 / 空白新建 */
export type ProjectSource = "example" | "upload" | "blank";

/** 一个工作空间项目（持久化单元） */
export interface Project {
  id: string;
  name: string;
  source: ProjectSource;
  createdAt: number;
  updatedAt: number;
  tree: ComponentTree;
  assets: GeneratedAsset[];
  /** 截图分析的能力来源（upload 项目才有） */
  analysisSource?: CapabilitySource;
  /** 原始截图 data URL（upload 项目才有，用于重新分析 / 展示） */
  imageDataUrl?: string;
}
