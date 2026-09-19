import { HomeView } from "@/components/home/HomeView";

export const dynamic = "force-dynamic";

/**
 * 项目列表页（Create Project / Recent Projects / Example Project）。
 *
 * 原为首页；阶段 17 起首页改为直接进入画布工作区，本页承载「新建 / 最近项目 / 示例」入口。
 */
export default function ProjectsPage() {
  return <HomeView />;
}
