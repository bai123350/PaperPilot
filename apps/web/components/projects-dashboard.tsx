"use client";

import Link from "next/link";
import { ArrowRight, Database, FileCheck2, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type ProjectRecord } from "../lib/api";
import { ProjectGrid } from "./project-grid";

export function ProjectsDashboard() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "项目加载失败"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <section className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">PaperPilot Workspace</span>
          <h1>生物医学研究情报</h1>
          <p>{projects.length ? `${projects.length} 个活跃研究项目` : "从一个可审计的研究问题开始"}</p>
        </div>
        <Link className="primary-button" href="/projects/new"><Plus size={17} />新建研究</Link>
      </section>

      <section className="metrics-band" aria-label="工作区概览">
        <div><Database size={19} /><span><strong>{projects.length}</strong><small>研究项目</small></span></div>
        <div><FileCheck2 size={19} /><span><strong>{projects.length ? "100%" : "—"}</strong><small>证据关联</small></span></div>
        <div><ShieldCheck size={19} /><span><strong>24h</strong><small>原文件保留</small></span></div>
      </section>

      <section className="section-block">
        <div className="section-title-row"><h2>最近项目</h2><Link href="/projects/new">创建新项目 <ArrowRight size={15} /></Link></div>
        {loading ? <div className="loading-lines"><span /><span /><span /></div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {!loading && !error ? <ProjectGrid projects={projects} /> : null}
      </section>
    </>
  );
}
