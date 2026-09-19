import type { ComponentTree } from "./types";
import type { RawComponentNode } from "./schema";
import { treeFromRaw } from "./tree";
import { ensureRects } from "./layout";

/**
 * 空白项目的起步结构（阶段 15）。
 *
 * 「Create Project」不应给出一张真正的空画布 —— 那会让用户面对零信息。
 * 这里给一个最小可用的页面骨架（Page → Header / Hero（Title + Illustration）/ Footer），
 * 坐标由 `ensureRects` 布局。用户随后可上传截图分析覆盖，或直接编辑。
 */

const STARTER: RawComponentNode = {
  name: "New Page",
  type: "page",
  children: [
    { name: "Header", type: "section" },
    {
      name: "Hero",
      type: "section",
      children: [
        { name: "Title", type: "component" },
        { name: "Illustration", type: "component" },
      ],
    },
    { name: "Footer", type: "section" },
  ],
};

export function createStarterTree(): ComponentTree {
  return ensureRects(treeFromRaw(STARTER));
}
