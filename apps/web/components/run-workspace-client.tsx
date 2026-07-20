"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Printer } from "lucide-react";

import { api, type RunRecord } from "../lib/api";
import type { RunConversationMessage } from "../lib/api";
import { mapReport } from "../lib/report-mapper";
import type { ReportViewModel } from "../lib/types";
import { RunWorkspaceView } from "./run-workspace-view";
import { ResearchConversation } from "./research-conversation";

export function RunWorkspaceClient({ runId }: { runId: string }) {
  const startRequested = useRef(false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [report, setReport] = useState<ReportViewModel | null>(null);
  const [messages, setMessages] = useState<RunConversationMessage[]>([]);
  const [reportVersion, setReportVersion] = useState(1);
  const [conversationPending, setConversationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const [nextRun, conversation] = await Promise.all([
          api.getRun(runId),
          api.getRunConversation(runId),
        ]);
        if (!active) return;
        setRun(nextRun);
        setMessages(conversation.messages);
        setReportVersion(conversation.report_version);
        if (nextRun.status === "queued" && !startRequested.current) {
          startRequested.current = true;
          void api.startRun(runId).then(refresh).catch((reason) => {
            if (active) setError(reason instanceof Error ? reason.message : "研究启动失败");
          });
          return;
        }
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
      <div className="run-dialog-layout">
        <RunWorkspaceView run={run} report={report} />
        <ResearchConversation
          messages={messages}
          pending={conversationPending}
          canRevise={run.status === "completed" && Boolean(report)}
          reportVersion={reportVersion}
          onSend={sendMessage}
        />
      </div>
    </>
  );

  async function sendMessage(content: string, action: "discuss" | "revise_report") {
    setConversationPending(true);
    setError(null);
    try {
      const response = await api.sendRunMessage(runId, content, action);
      const conversation = await api.getRunConversation(runId);
      setMessages(conversation.messages);
      setReportVersion(response.report_version);
      if (response.report_updated) {
        const rawReport = await api.getReport(runId);
        setReport(mapReport(rawReport as Parameters<typeof mapReport>[0]));
        setRun((current) => current ? { ...current, report_version: response.report_version } : current);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "消息发送失败");
    } finally {
      setConversationPending(false);
    }
  }
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
