"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BookOpenCheck, Plus, Settings, ShieldCheck } from "lucide-react";

import { ModelSettingsControl } from "./model-settings-control";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = pathname.startsWith("/runs/")
    || (pathname.startsWith("/projects/") && pathname !== "/projects/new");

  if (workspace) {
    return (
      <div className="app-shell app-shell-workspace">
        <header className="workspace-titlebar">
          <Link href="/"><ArrowLeft size={16} aria-hidden="true" />项目</Link>
          <strong>PaperPilot 研究工作区</strong>
          <div className="workspace-titlebar-actions">
            <ModelSettingsControl compact />
            <Link href="/settings"><Settings size={15} aria-hidden="true" />数据设置</Link>
            <span><ShieldCheck size={15} aria-hidden="true" />证据可追溯</span>
          </div>
        </header>
        <main className="workspace-main">{children}</main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="web-header">
        <Link className="web-brand" href="/" aria-label="PaperPilot 首页">
          <BookOpenCheck size={25} aria-hidden="true" />
          <span><strong>PaperPilot</strong><small>Biomedical intelligence</small></span>
        </Link>
        <nav aria-label="主导航">
          <ModelSettingsControl />
          <Link href="/projects/new"><Plus size={16} aria-hidden="true" /><span>新建研究</span></Link>
          <Link href="/settings"><Settings size={16} aria-hidden="true" /><span>数据设置</span></Link>
          <span><ShieldCheck size={15} aria-hidden="true" />研究数据受保护</span>
        </nav>
      </header>
      <main className="main-frame">
        <div className="page-content">
          {children}
        </div>
      </main>
    </div>
  );
}
