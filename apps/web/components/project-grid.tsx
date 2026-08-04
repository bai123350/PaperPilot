import Link from "next/link";
import { ArrowUpRight, BookOpenCheck, FileSearch, Trash2 } from "lucide-react";

import type { ProjectRecord } from "../lib/api";

export function ProjectGrid({
  projects,
  deletingProjectId,
  onDelete,
}: {
  projects: ProjectRecord[];
  deletingProjectId?: string | null;
  onDelete?: (project: ProjectRecord) => Promise<void> | void;
}) {
  if (!projects.length) {
    return (
      <div className="empty-state">
        <FileSearch size={30} aria-hidden="true" />
        <h2>尚无研究项目</h2>
        <Link className="primary-button" href="/projects/new">新建研究</Link>
      </div>
    );
  }

  return (
    <div className="project-grid">
      {projects.map((project) => (
        <article className="project-card" key={project.id}>
          <div className="project-card-topline">
            <span className="project-icon"><BookOpenCheck size={20} aria-hidden="true" /></span>
            <div className="project-card-meta">
              <time dateTime={project.updated_at}>
                {new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(project.updated_at))}
              </time>
              {onDelete ? (
                <button
                  className="project-delete-button"
                  type="button"
                  aria-label={`删除项目：${project.name}`}
                  title="删除项目"
                  disabled={deletingProjectId === project.id}
                  onClick={() => void onDelete(project)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <h2>{project.name}</h2>
          <p>{project.description || "生物医学研究情报项目"}</p>
          <Link href={`/projects/${project.id}`}>
            打开项目 <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </article>
      ))}
    </div>
  );
}
