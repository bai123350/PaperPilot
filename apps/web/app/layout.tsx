import type { Metadata } from "next";

import { AppShell } from "../components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaperPilot · 生物医学研究情报",
  description: "Evidence-first biomedical research intelligence workspace",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
