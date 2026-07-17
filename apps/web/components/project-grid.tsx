import Link from "next/link";
import { ArrowUpRight, FileSearch, FolderKanban } from "lucide-react";

import type { ProjectRecord } from "../lib/api";

export function ProjectGrid({ projects }: { projects: ProjectRecord[] }) {
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
            <span className="project-icon"><FolderKanban size={18} aria-hidden="true" /></span>
            <time dateTime={project.updated_at}>
              {new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(project.updated_at))}
            </time>
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
