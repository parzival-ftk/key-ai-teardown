import { WorkspaceView } from "@/components/workspace/WorkspaceView";
import { EXAMPLE_PROJECT_ID } from "@/lib/components/demo-project";

export const dynamic = "force-dynamic";

/**
 * 产品首页 —— 打开即进入画布工作区。
 *
 * 产品核心界面是 Canvas，不是 Dashboard。因此首页直接渲染内置示例工作区的画布，
 * 让「打开 http://localhost:3000 就能看到并操作画布」成立。
 * 项目列表 / 新建入口保留在 `/projects`。
 */
export default function Home() {
  return <WorkspaceView projectId={EXAMPLE_PROJECT_ID} />;
}
