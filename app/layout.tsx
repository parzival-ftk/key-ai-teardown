import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Key · Interface Analysis & Visual Decomposition",
  description:
    "AI-powered interface analysis and visual decomposition workspace：上传界面截图，拆解成结构化组件树，在无限画布上组织、检查，并通过 ComfyUI 生成视觉资产。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
