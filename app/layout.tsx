import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TaqMan CNV 板布局规划工具",
  description:
    "96/384 孔 TaqMan CNV duplex/multiplex 板布局、10 µL 反应体系和 QuantStudio 样本列表导出工具。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
