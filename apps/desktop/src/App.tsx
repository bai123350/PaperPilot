import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  FolderPlus,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  tauriBridge,
  type DesktopBridge,
  type ModelSettings,
  type SaveModelSettingsInput,
} from "./bridge";
import type {
  ExportFormat,
  Project,
  Report,
  ResearchBrief,
  RunEvent,
  RunSnapshot,
} from "./generated/contracts";
import { Workspace } from "./workspace";
import { ModelSettingsDialog } from "./model-settings-dialog";
import "./App.css";

export function App({ bridge = tauriBridge }: { bridge?: DesktopBridge }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [queuedProjectName, setQueuedProjectName] = useState<string | null>(null);
  const [runFailure, setRunFailure] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [rerunDraft, setRerunDraft] = useState<ResearchBrief | null>(null);
  const [runHistory, setRunHistory] = useState<RunSnapshot[]>([]);
  const [selectedReportRunId, setSelectedReportRunId] = useState<string | null>(null);
  const [historicalReport, setHistoricalReport] = useState<Report | null>(null);
  const [historicalReportLoading, setHistoricalReportLoading] = useState(false);
  const latestRunEvent = useRef<
    Record<string, { sequence: number; signature: string }>
  >({});
  const projectLoadSequence = useRef(0);
  const reportLoadSequence = useRef(0);

  useEffect(() => {
    bridge.listProjects().then(setProjects).catch(showError);
    bridge
      .getModelSettings()
      .then(setModelSettings)
      .catch(showError)
      .finally(() => setSettingsLoaded(true));
  }, [bridge]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    bridge
      .listenRunEvents((event) => {
        void applyRunEvent(event);
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(showError);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [bridge, selected?.id]);

  async function createProject() {
    const name = newName.trim() || `新研究项目 ${projects.length + 1}`;
    if (!modelSettings?.configured) {
      setQueuedProjectName(name);
      setSettingsRequired(true);
      setSettingsOpen(true);
      setSettingsError(null);
      return;
    }
    await persistProject(name);
  }

  async function persistProject(name: string) {
    setPending(true);
    setError(null);
    try {
      const project = await bridge.createProject(name, "");
      setProjects((current) => [project, ...current]);
      setNewName("");
      setSelected(project);
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  async function openProject(project: Project) {
    const sequence = projectLoadSequence.current + 1;
    projectLoadSequence.current = sequence;
    setSelected(project);
    setSnapshot(null);
    setReport(null);
    setRerunDraft(null);
    setRunHistory([]);
    showCurrentReport();
    setRunFailure(null);
    setError(null);
    setLoadingProject(true);
    try {
      const snapshots = bridge.listProjectRunSnapshots
        ? await bridge.listProjectRunSnapshots(project.id)
        : await loadProjectSnapshotsLegacy(bridge, project.id);
      const nextSnapshot = snapshots.at(-1) ?? null;
      if (projectLoadSequence.current !== sequence) return;
      const nextReport =
        nextSnapshot?.run.status === "completed"
          ? await bridge.getReport(nextSnapshot.run.id)
          : null;
      if (projectLoadSequence.current !== sequence) return;
      setRunHistory(snapshots);
      setSnapshot(nextSnapshot);
      setReport(nextReport);
      if (nextSnapshot?.run.status === "failed") {
        const persistedFailure = [...nextSnapshot.messages]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant"
              && message.content.startsWith("研究运行失败："),
          );
        setRunFailure(
          persistedFailure?.content
            ?? "上次研究运行失败，未生成报告。可修改模型设置后重新运行。",
        );
      }
    } catch (reason) {
      if (projectLoadSequence.current === sequence) showError(reason);
    } finally {
      if (projectLoadSequence.current === sequence) setLoadingProject(false);
    }
  }

  async function saveModelSettings(input: SaveModelSettingsInput) {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const saved = await bridge.saveModelSettings(input);
      setModelSettings(saved);
      setSettingsOpen(false);
      setSettingsRequired(false);
      const projectName = queuedProjectName;
      setQueuedProjectName(null);
      if (projectName) await persistProject(projectName);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function startResearch(brief: ResearchBrief) {
    if (!selected) return;
    showCurrentReport();
    setPending(true);
    setError(null);
    setRunFailure(null);
    try {
      const run = await bridge.startRun(selected.id, brief);
      setRerunDraft(null);
      await refreshRun(run.id);
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  async function retryResearch() {
    if (!snapshot || snapshot.run.status !== "failed") return;
    setPending(true);
    setError(null);
    setRunFailure(null);
    setReport(null);
    try {
      const run = await bridge.retryRun(snapshot.run.id);
      await refreshRun(run.id);
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  function prepareRerun() {
    if (!snapshot || snapshot.run.status !== "completed") return;
    showCurrentReport();
    setError(null);
    setRunFailure(null);
    setRerunDraft(snapshot.brief);
  }

  async function exportReport(format: ExportFormat) {
    const activeReport = selectedReportRunId ? historicalReport : report;
    const activeRunId = selectedReportRunId ?? snapshot?.run.id;
    if (!activeRunId || !activeReport) return;
    setPending(true);
    setError(null);
    try {
      const exported = await bridge.exportReport(activeRunId, format);
      if (format === "print_html") {
        const printWindow = window.open("", "_blank");
        if (!printWindow) throw new Error("无法打开打印窗口，请允许 PaperPilot 打开新窗口。");
        printWindow.opener = null;
        printWindow.document.write(exported.content);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        return;
      }

      const url = URL.createObjectURL(
        new Blob([exported.content], { type: "text/markdown;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.suggestedFilename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  async function sendMessage(content: string) {
    if (!snapshot) return;
    if (isRerunRequest(content)) {
      await startResearch(applyRerunConstraints(snapshot.brief, content));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await bridge.sendMessage(snapshot.run.id, content);
      await refreshRun(snapshot.run.id);
      if (result.reportUpdated) setReport(await bridge.getReport(snapshot.run.id));
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  function showCurrentReport() {
    reportLoadSequence.current += 1;
    setSelectedReportRunId(null);
    setHistoricalReport(null);
    setHistoricalReportLoading(false);
  }

  async function selectRunReport(runId: string | null) {
    if (!runId || runId === snapshot?.run.id) {
      showCurrentReport();
      return;
    }
    const selectedSnapshot = runHistory.find((item) => item.run.id === runId);
    if (!selectedSnapshot || selectedSnapshot.run.status !== "completed") {
      setError("该次运行未生成完整报告。");
      return;
    }
    const sequence = reportLoadSequence.current + 1;
    reportLoadSequence.current = sequence;
    setSelectedReportRunId(runId);
    setHistoricalReport(null);
    setHistoricalReportLoading(true);
    setError(null);
    try {
      const nextReport = await bridge.getReport(runId);
      if (reportLoadSequence.current !== sequence) return;
      setHistoricalReport(nextReport);
    } catch (reason) {
      if (reportLoadSequence.current !== sequence) return;
      setSelectedReportRunId(null);
      setHistoricalReport(null);
      showError(reason);
    } finally {
      if (reportLoadSequence.current === sequence) {
        setHistoricalReportLoading(false);
      }
    }
  }

  async function refreshRun(runId: string) {
    const next = await bridge.getRunSnapshot(runId);
    setSnapshot(next);
    setRunHistory((current) => upsertRunSnapshot(current, next));
    if (next.run.status === "completed") setReport(await bridge.getReport(runId));
  }

  async function applyRunEvent(event: RunEvent) {
    if (!selected) return;
    const signature = `${event.operation?.status ?? "none"}:${event.safeSummary}`;
    const latest = latestRunEvent.current[event.runId];
    if (
      latest
      && (event.sequence < latest.sequence
        || (event.sequence === latest.sequence && signature === latest.signature))
    ) {
      return;
    }
    latestRunEvent.current[event.runId] = {
      sequence: event.sequence,
      signature,
    };
    try {
      const next = await bridge.getRunSnapshot(event.runId);
      if (
        next.run.projectId !== selected.id
        || latestRunEvent.current[event.runId]?.sequence !== event.sequence
        || latestRunEvent.current[event.runId]?.signature !== signature
      ) {
        return;
      }
      setSnapshot(next);
      setRunHistory((current) => upsertRunSnapshot(current, next));
      if (event.status === "failed") setRunFailure(event.safeSummary);
      if (event.status === "completed") {
        setReport(await bridge.getReport(event.runId));
      }
    } catch (reason) {
      showError(reason);
    }
  }

  async function deleteProject(project: Project) {
    setPending(true);
    try {
      await bridge.deleteProject(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (selected?.id === project.id) {
        setSelected(null);
        setSnapshot(null);
        setReport(null);
        setRerunDraft(null);
        setRunHistory([]);
        showCurrentReport();
      }
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }

  function openSettings() {
    setSettingsRequired(false);
    setSettingsError(null);
    setSettingsOpen(true);
  }

  function settingsDialog() {
    return settingsOpen ? (
      <ModelSettingsDialog
        current={modelSettings}
        required={settingsRequired}
        saving={settingsSaving}
        error={settingsError}
        onClose={() => {
          setSettingsOpen(false);
          setQueuedProjectName(null);
        }}
        onSave={saveModelSettings}
      />
    ) : null;
  }

  if (selected) {
    return (
      <div className="desktop-shell">
        <header className="desktop-titlebar">
          <button type="button" onClick={() => { projectLoadSequence.current += 1; setSelected(null); setSnapshot(null); setReport(null); setRunFailure(null); setRerunDraft(null); setRunHistory([]); showCurrentReport(); setLoadingProject(false); }}>
            <ArrowLeft size={16} />项目
          </button>
          <strong>{selected.name}</strong>
          <div className="titlebar-actions">
            <button type="button" onClick={openSettings}><Settings size={15} />模型设置</button>
            <span><ShieldCheck size={15} />本地加密</span>
          </div>
        </header>
        {error ? <p className="desktop-error" role="alert">{error}</p> : null}
        {loadingProject ? (
          <div className="project-history-loading" role="status">
            <span />
            <strong>正在恢复项目记录</strong>
            <p>加载上次对话、研究操作和报告…</p>
          </div>
        ) : (
          <Workspace
            projectName={selected.name}
            run={rerunDraft ? null : snapshot?.run ?? null}
            messages={rerunDraft ? [] : snapshot?.messages ?? []}
            operations={rerunDraft ? [] : snapshot?.operations ?? []}
            previousRuns={
              rerunDraft
                ? runHistory
                : runHistory.filter((item) => item.run.id !== snapshot?.run.id)
            }
            report={
              rerunDraft
                ? null
                : selectedReportRunId
                  ? historicalReport
                  : report
            }
            selectedRunId={selectedReportRunId}
            reportLoading={historicalReportLoading}
            onSelectRun={selectRunReport}
            pending={pending}
            onStart={startResearch}
            onSend={sendMessage}
            onExport={exportReport}
            failureReason={runFailure}
            onRetry={retryResearch}
            onOpenSettings={openSettings}
            rerunDraft={rerunDraft}
            onPrepareRerun={prepareRerun}
            onCancelRerun={() => setRerunDraft(null)}
          />
        )}
        {settingsDialog()}
      </div>
    );
  }

  return (
    <main className="project-home">
      <header>
        <div className="project-brand"><BookOpenCheck size={25} /><div><strong>PaperPilot</strong><span>Local biomedical intelligence</span></div></div>
        <div className="home-actions">
          <button
            className="settings-button"
            type="button"
            onClick={openSettings}
          >
            <Settings size={16} aria-hidden="true" />
            设置
          </button>
          <span className="local-badge"><ShieldCheck size={15} />项目数据仅保存在本机</span>
        </div>
      </header>
      <section className="project-heading">
        <div><span>Windows research workspace</span><h1>本地研究项目</h1><p>从研究问题出发，持续查看证据流水线，并在右侧获得完整报告。</p></div>
        <div className="new-project"><input aria-label="项目名称" placeholder={`新研究项目 ${projects.length + 1}`} value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createProject(); }} /><button type="button" disabled={pending || !settingsLoaded} onClick={() => void createProject()}><FolderPlus size={17} />新建项目</button></div>
      </section>
      {error ? <p className="desktop-error" role="alert">{error}</p> : null}
      <section className="project-grid" aria-label="项目列表">
        {projects.map((project) => (
          <article className="project-card" key={project.id}>
            <button className="project-open" type="button" onClick={() => void openProject(project)}>
              <span className="project-card-icon"><BookOpenCheck size={21} /></span>
              <strong>{project.name}</strong><p>{project.description || "本地加密研究项目"}</p><time>{new Date(project.updatedAt).toLocaleDateString("zh-CN")}</time>
            </button>
            <button className="project-delete" type="button" aria-label={`删除 ${project.name}`} onClick={() => void deleteProject(project)}><Trash2 size={15} /></button>
          </article>
        ))}
        {!projects.length ? <div className="project-empty"><FolderPlus size={24} /><strong>还没有本地项目</strong><p>输入名称创建第一个研究项目。</p></div> : null}
      </section>
      {settingsDialog()}
    </main>
  );
}

function isRerunRequest(content: string): boolean {
  return /(重新运行|重新检索|重新生成(?:一份)?报告|重跑)/.test(content);
}

function applyRerunConstraints(brief: ResearchBrief, content: string): ResearchBrief {
  const next = {
    ...brief,
    outcomes: [...brief.outcomes],
    keywords: [...brief.keywords],
    studyTypes: [...brief.studyTypes],
  };
  const range = content.match(/((?:19|20)\d{2})\s*年?\s*(?:-|—|至|到)\s*((?:19|20)\d{2})/);
  if (range) {
    next.dateFrom = Number(range[1]);
    next.dateTo = Number(range[2]);
    return next;
  }
  const from = content.match(/从\s*((?:19|20)\d{2})\s*年?(?:开始|起)?/);
  if (from) next.dateFrom = Number(from[1]);
  return next;
}

function upsertRunSnapshot(
  snapshots: RunSnapshot[],
  next: RunSnapshot,
): RunSnapshot[] {
  const existing = snapshots.findIndex((item) => item.run.id === next.run.id);
  if (existing < 0) return [...snapshots, next];
  return snapshots.map((item, index) => (index === existing ? next : item));
}

async function loadProjectSnapshotsLegacy(
  bridge: DesktopBridge,
  projectId: string,
): Promise<RunSnapshot[]> {
  const latest = await bridge.getLatestProjectRun(projectId);
  return latest ? [await bridge.getRunSnapshot(latest.id)] : [];
}
