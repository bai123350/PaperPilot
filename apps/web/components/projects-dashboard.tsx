"use client";

import { FolderPlus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { api, type ProjectRecord } from "../lib/api";
import { ProjectGrid } from "./project-grid";

export function ProjectsDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "项目加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const name = projectName.trim();
    if (name.length < 3) return;
    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject(
        name,
        "等待填写研究问题",
      );
      setProjects((current) => [project, ...current]);
      setCreateOpen(false);
      setProjectName("");
      router.push(`/projects/${project.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目创建失败");
      setCreating(false);
    }
  }

  return (
    <>
      <section className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">Web research workspace</span>
          <h1>研究项目</h1>
          <p>从研究问题出发，持续查看证据流水线，并在同一工作区阅读报告。</p>
        </div>
        <button className="primary-button" type="button" disabled={loading} onClick={() => { setError(null); setCreateOpen(true); }}>
          <Plus size={17} />新建项目
        </button>
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

      {createOpen ? (
        <div className="project-create-backdrop" role="presentation">
          <section className="project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
            <header>
              <span className="project-create-icon"><FolderPlus size={20} aria-hidden="true" /></span>
              <div>
                <span className="eyebrow">New project</span>
                <h2 id="project-create-title">命名研究项目</h2>
              </div>
              <button className="project-create-close" type="button" aria-label="关闭项目命名" disabled={creating} onClick={() => setCreateOpen(false)}>
                <X size={17} aria-hidden="true" />
              </button>
            </header>
            <p>项目会立即保存。之后可在同一工作区持续补充研究问题、证据和报告。</p>
            <form onSubmit={createProject}>
              <label htmlFor="new-project-name">项目名称</label>
              <input
                id="new-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder={`新研究项目 ${projects.length + 1}`}
                minLength={3}
                maxLength={200}
                disabled={creating}
                autoFocus
              />
              <footer>
                <button type="button" disabled={creating} onClick={() => setCreateOpen(false)}>取消</button>
                <button className="project-create-submit" type="submit" disabled={creating || projectName.trim().length < 3}>
                  <FolderPlus size={16} aria-hidden="true" />{creating ? "正在创建" : "创建项目"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
