import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpenCheck, FolderPlus, ShieldCheck, Trash2 } from "lucide-react";

import { tauriBridge, type DesktopBridge } from "./bridge";
import type {
  ExportFormat,
  Project,
  Report,
  ResearchBrief,
  RunEvent,
  RunSnapshot,
} from "./generated/contracts";
import { Workspace } from "./workspace";
import "./App.css";

export function App({ bridge = tauriBridge }: { bridge?: DesktopBridge }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const latestEventSequence = useRef<Record<string, number>>({});

  useEffect(() => {
    bridge.listProjects().then(setProjects).catch(showError);
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
    const name = newName.trim();
    if (!name) return;
    setPending(true);
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

  async function startResearch(brief: ResearchBrief) {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const run = await bridge.startRun(selected.id, brief);
      await refreshRun(run.id);
    } catch (reason) {
      showError(reason);
    } finally {
      setPending(false);
    }
  }

  async function exportReport(format: ExportFormat) {
    if (!snapshot || !report) return;
    setPending(true);
    setError(null);
    try {
      const exported = await bridge.exportReport(snapshot.run.id, format);
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

  async function refreshRun(runId: string) {
    const next = await bridge.getRunSnapshot(runId);
    setSnapshot(next);
    if (next.run.status === "completed") setReport(await bridge.getReport(runId));
  }

  async function applyRunEvent(event: RunEvent) {
    if (!selected) return;
    const latest = latestEventSequence.current[event.runId] ?? 0;
    if (event.sequence <= latest) return;
    latestEventSequence.current[event.runId] = event.sequence;
    try {
      const next = await bridge.getRunSnapshot(event.runId);
      if (
        next.run.projectId !== selected.id
        || latestEventSequence.current[event.runId] !== event.sequence
      ) {
        return;
      }
      setSnapshot(next);
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

  if (selected) {
    return (
      <div className="desktop-shell">
        <header className="desktop-titlebar">
          <button type="button" onClick={() => { setSelected(null); setSnapshot(null); setReport(null); }}>
            <ArrowLeft size={16} />项目
          </button>
          <strong>{selected.name}</strong>
          <span><ShieldCheck size={15} />本地加密</span>
        </header>
        {error ? <p className="desktop-error" role="alert">{error}</p> : null}
        <Workspace
          projectName={selected.name}
          run={snapshot?.run ?? null}
          messages={snapshot?.messages ?? []}
          operations={snapshot?.operations ?? []}
          report={report}
          pending={pending}
          onStart={startResearch}
          onSend={sendMessage}
          onExport={exportReport}
        />
      </div>
    );
  }

  return (
    <main className="project-home">
      <header>
        <div className="project-brand"><BookOpenCheck size={25} /><div><strong>PaperPilot</strong><span>Local biomedical intelligence</span></div></div>
        <span className="local-badge"><ShieldCheck size={15} />项目数据仅保存在本机</span>
      </header>
      <section className="project-heading">
        <div><span>Windows research workspace</span><h1>本地研究项目</h1><p>从研究问题出发，持续查看证据流水线，并在右侧获得完整报告。</p></div>
        <div className="new-project"><input aria-label="项目名称" placeholder="新项目名称" value={newName} onChange={(event) => setNewName(event.target.value)} /><button type="button" disabled={!newName.trim() || pending} onClick={() => void createProject()}><FolderPlus size={17} />新建项目</button></div>
      </section>
      {error ? <p className="desktop-error" role="alert">{error}</p> : null}
      <section className="project-grid" aria-label="项目列表">
        {projects.map((project) => (
          <article className="project-card" key={project.id}>
            <button className="project-open" type="button" onClick={() => setSelected(project)}>
              <span className="project-card-icon"><BookOpenCheck size={21} /></span>
              <strong>{project.name}</strong><p>{project.description || "本地加密研究项目"}</p><time>{new Date(project.updatedAt).toLocaleDateString("zh-CN")}</time>
            </button>
            <button className="project-delete" type="button" aria-label={`删除 ${project.name}`} onClick={() => void deleteProject(project)}><Trash2 size={15} /></button>
          </article>
        ))}
        {!projects.length ? <div className="project-empty"><FolderPlus size={24} /><strong>还没有本地项目</strong><p>输入名称创建第一个研究项目。</p></div> : null}
      </section>
    </main>
  );
}
