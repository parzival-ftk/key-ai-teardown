import { HomeView } from "@/components/home/HomeView";

export const dynamic = "force-dynamic";

/**
 * 产品首页（阶段 15，spec §17/§18）。
 *
 * 入口只有三件事：Create Project / Recent Projects / Example Project。
 * 项目数据存在浏览器本地（localStorage），因此首页是客户端组件。
 */
export default function Home() {
  return <HomeView />;
}
