"use client";

import { useRouter } from "next/navigation";

import { api, type ResearchBriefInput } from "../lib/api";
import { NewResearchForm } from "./new-research-form";

export function NewProjectWorkflow({ projectId }: { projectId?: string }) {
  const router = useRouter();

  async function start(brief: ResearchBriefInput, files: File[]) {
    const project = projectId
      ? await api.getProject(projectId)
      : await api.createProject(
          brief.question.slice(0, 72).replace(/[?？]$/, ""),
          brief.population ? `研究人群：${brief.population}` : "探索性生物医学研究情报",
        );
    await Promise.all(files.map((file) => api.uploadPdf(project.id, file)));
    const run = await api.createRun(project.id, brief);
    router.push(`/runs/${run.id}`);
  }

  return <NewResearchForm onSubmit={start} />;
}
