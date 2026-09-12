import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Key · AI 产品拆解助手",
  description: "把任何产品拆成关键洞察（Key · 让每个产品都讲得清）。",
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
