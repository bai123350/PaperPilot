"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
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
          <span className="eyebrow">Web research workspace</span>
          <h1>研究项目</h1>
          <p>从研究问题出发，持续查看证据流水线，并在同一工作区阅读报告。</p>
        </div>
        <Link className="primary-button" href="/projects/new"><Plus size={17} />新建项目</Link>
      </section>

      <section className="section-block">
        <div className="section-title-row">
          <h2>最近项目</h2>
          <span className="project-count">{projects.length} 个项目</span>
        </div>
        {loading ? (
          <div className="loading-lines">
            <span suppressHydrationWarning />
            <span suppressHydrationWarning />
            <span suppressHydrationWarning />
          </div>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {!loading && !error ? <ProjectGrid projects={projects} /> : null}
      </section>
    </>
  );
}
