"use client";

import { useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";

import { api, type RunRecord } from "../lib/api";
import { mapReport } from "../lib/report-mapper";
import type { ReportViewModel } from "../lib/types";
import { RunWorkspaceView } from "./run-workspace-view";

export function RunWorkspaceClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [report, setReport] = useState<ReportViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const nextRun = await api.getRun(runId);
        if (!active) return;
        setRun(nextRun);
        if (nextRun.status === "completed") {
          const rawReport = await api.getReport(runId);
          if (active) setReport(mapReport(rawReport as Parameters<typeof mapReport>[0]));
          return;
        }
        if (!["failed", "cancelled"].includes(nextRun.status)) {
          timer = setTimeout(refresh, 1200);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "运行加载失败");
      }
    }

    refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!run) return <div className="run-loading"><span /><p>正在读取研究状态</p></div>;
  return (
    <>
      {run.status === "completed" ? (
        <div className="report-toolbar">
          <button type="button" onClick={() => window.print()}><Printer size={16} />打印 / PDF</button>
          <button type="button" onClick={() => downloadMarkdown(run.id)}><Download size={16} />Markdown</button>
        </div>
      ) : null}
      <RunWorkspaceView run={run} report={report} />
    </>
  );
}

async function downloadMarkdown(runId: string) {
  const blob = await api.downloadMarkdown(runId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `paperpilot-${runId.slice(0, 8)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
