"use client";

import { useEffect, useState } from "react";
import { FileClock } from "lucide-react";

import {
  api,
  type ResearchAssistantMessage,
  type ResearchBriefInput,
} from "../lib/api";
import { NewResearchForm } from "./new-research-form";
import { RunWorkspaceClient } from "./run-workspace-client";

export function NewProjectWorkflow({ projectId }: { projectId?: string }) {
  const [loadingProject, setLoadingProject] = useState(Boolean(projectId));
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    api.listProjectRuns(projectId)
      .then((runs) => {
        if (!active) return;
        if (runs[0]) setActiveRunId(runs[0].id);
        setLoadingProject(false);
      })
      .catch((reason) => {
        if (!active) return;
        setLoadError(reason instanceof Error ? reason.message : "项目对话加载失败");
        setLoadingProject(false);
      });
    return () => { active = false; };
  }, [projectId]);

  async function start(
    brief: ResearchBriefInput,
    files: File[],
    messages: ResearchAssistantMessage[],
  ) {
    const project = projectId
      ? await api.getProject(projectId)
      : await api.createProject(
          brief.question.slice(0, 72).replace(/[?？]$/, ""),
          brief.population ? `研究人群：${brief.population}` : "探索性生物医学研究情报",
        );
    await Promise.all(files.map((file) => api.uploadPdf(project.id, file)));
    const run = await api.createRun(project.id, brief);
    await api.bootstrapRunConversation(run.id, messages);
    if (!projectId) {
      window.history.replaceState(window.history.state, "", `/projects/${project.id}`);
    }
    setActiveRunId(run.id);
  }

  if (loadingProject) {
    return <div className="run-loading"><span /><p>正在恢复项目对话</p></div>;
  }
  if (loadError) return <div className="error-banner">{loadError}</div>;
  if (activeRunId) return <RunWorkspaceClient runId={activeRunId} />;
  if (projectId) {
    return (
      <div className="project-start-workspace">
        <NewResearchForm onSubmit={start} />
        <div className="run-report-state" aria-live="polite">
          <span className="report-waiting-icon" aria-hidden="true"><FileClock size={25} /></span>
          <h1>从研究问题开始</h1>
          <p>提交问题后，检索、证据抽取和研究综合会在左侧持续更新，报告将在这里生成。</p>
        </div>
      </div>
    );
  }
  return <NewResearchForm onSubmit={start} />;
}
