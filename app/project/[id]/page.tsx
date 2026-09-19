import { WorkspaceView } from "@/components/workspace/WorkspaceView";

export const metadata = {
  title: "项目工作区 · Key",
  description: "在无限画布上浏览组件树、检查组件属性与 Prompt，并通过 ComfyUI 生成视觉资产。",
};

/** 项目工作区（阶段 15，spec §17）。路由参数即项目 id。 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkspaceView projectId={id} />;
}
