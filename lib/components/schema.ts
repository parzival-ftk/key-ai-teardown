import { z } from "zod";
import type { ComponentTree, Project } from "./types";
import { treeFromRaw } from "./tree";

/**
 * 组件树的 zod schema（阶段 15）。
 *
 * 两个边界：
 *   ① **AI 输出**（嵌套 JSON）→ `AnalysisResponseSchema`：模型可能给出任意形状，
 *      先校验再归一，绝不让未校验的 JSON 进入画布。
 *   ② **持久化**（扁平树 / 项目）→ `ComponentTreeSchema` / `ProjectSchema`：
 *      localStorage 里的历史数据可能来自旧版本或被手工篡改，读回时逐一校验。
 *
 * 与 `lib\config.ts`、`lib\types\*` 同一套用法（schema 定义 + `z.infer` 类型）。
 */

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const ComponentTypeSchema = z.enum(["page", "section", "component", "element"]);

export const ComponentPropertiesSchema = z.object({
  role: z.string().optional(),
  text: z.string().optional(),
  style: z.string().optional(),
  visualDescription: z.string().optional(),
});

/** 扁平树节点：children 是 **id 列表**，不是嵌套对象 */
export const ComponentNodeSchema = z.object({
  id: z.string().min(1),
  type: ComponentTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  rect: RectSchema,
  parentId: z.string().optional(),
  children: z.array(z.string()),
  properties: ComponentPropertiesSchema.optional(),
  prompt: z.string().optional(),
});

export const ComponentTreeSchema = z.object({
  rootId: z.string().min(1),
  nodes: z.record(z.string(), ComponentNodeSchema),
});

export const GeneratedAssetSchema = z.object({
  id: z.string().min(1),
  componentId: z.string().min(1),
  provider: z.string().min(1),
  prompt: z.string(),
  artifactPath: z.string(),
  url: z.string().optional(),
  width: z.number(),
  height: z.number(),
  createdAt: z.string(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(["example", "upload"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  tree: ComponentTreeSchema,
  assets: z.array(GeneratedAssetSchema),
  analysisSource: z.enum(["real", "demo", "mock"]).optional(),
  imageDataUrl: z.string().optional(),
});

/* ── AI 分析的嵌套输出（递归） ── */

export interface RawComponentNode {
  type?: "page" | "section" | "component" | "element";
  name: string;
  description?: string;
  rect?: { x: number; y: number; width: number; height: number };
  properties?: {
    role?: string;
    text?: string;
    style?: string;
    visualDescription?: string;
  };
  prompt?: string;
  children?: RawComponentNode[];
}

export const RawComponentNodeSchema: z.ZodType<RawComponentNode> = z.lazy(() =>
  z.object({
    type: ComponentTypeSchema.optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    rect: RectSchema.optional(),
    properties: ComponentPropertiesSchema.optional(),
    prompt: z.string().optional(),
    children: z.array(RawComponentNodeSchema).optional(),
  }),
);

export const AnalysisResponseSchema = z.object({
  page: RawComponentNodeSchema,
});

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

/** 校验结果：成功给出规范化的扁平树，失败给出可读错误（不抛错） */
export type AnalysisParseResult =
  | { ok: true; tree: ComponentTree }
  | { ok: false; error: string };

/** 校验 AI 输出的结构化 JSON（嵌套）并归一成扁平树 */
export function parseAnalysisResponse(raw: unknown): AnalysisParseResult {
  const parsed = AnalysisResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  return { ok: true, tree: treeFromRaw(parsed.data.page) };
}

/** 校验扁平树（持久化读取用）；不合法返回 null */
export function parseComponentTree(raw: unknown): ComponentTree | null {
  const parsed = ComponentTreeSchema.safeParse(raw);
  return parsed.success ? (parsed.data as ComponentTree) : null;
}

/** 校验项目对象（持久化读取用）；不合法返回 null */
export function parseProject(raw: unknown): Project | null {
  const parsed = ProjectSchema.safeParse(raw);
  return parsed.success ? (parsed.data as Project) : null;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "结构校验失败";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
