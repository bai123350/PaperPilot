"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck, FolderKanban, Plus, Settings } from "lucide-react";

const navigation = [
  { href: "/", label: "研究项目", icon: FolderKanban },
  { href: "/projects/new", label: "新建研究", icon: Plus },
  { href: "/settings", label: "数据设置", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="PaperPilot 首页">
          <span className="brand-mark"><BookOpenCheck size={22} aria-hidden="true" /></span>
          <span><strong>PaperPilot</strong><small>Biomedical intelligence</small></span>
        </Link>
        <nav aria-label="主导航">
          {navigation.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link className={active ? "active" : ""} href={item.href} key={item.href}>
                <item.icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="security-dot" />
          <span><strong>隐私模式</strong><small>原文件 24h 清理</small></span>
        </div>
      </aside>
      <div className="main-frame">
        <header className="topbar">
          <span className="topbar-context">Research workspace</span>
          <div className="researcher-avatar" aria-label="当前用户">PR</div>
        </header>
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
