"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Printer } from "lucide-react";

import { api, type RunRecord } from "../lib/api";
import type { RunConversationMessage } from "../lib/api";
import { mapReport } from "../lib/report-mapper";
import type { ReportViewModel } from "../lib/types";
import { RunWorkspaceView } from "./run-workspace-view";
import { ResearchConversation } from "./research-conversation";

export function RunWorkspaceClient({ runId }: { runId: string }) {
  const startRequested = useRef(false);
  const replyRequested = useRef(false);
  const streamActive = useRef(false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [report, setReport] = useState<ReportViewModel | null>(null);
  const [messages, setMessages] = useState<RunConversationMessage[]>([]);
  const [reportVersion, setReportVersion] = useState(1);
  const [conversationPending, setConversationPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);

  const streamReply = useCallback(async (content: string, appendUser: boolean) => {
    const optimisticUser: RunConversationMessage = {
      id: `pending-user-${Date.now()}`,
      role: "user",
      content,
      evidence_ids: [],
      report_version: null,
      created_at: new Date().toISOString(),
    };
    const optimisticAssistant: RunConversationMessage = {
      id: `pending-assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      evidence_ids: [],
      report_version: null,
      created_at: new Date().toISOString(),
    };
    const assistantId = optimisticAssistant.id;
    setMessages((current) => appendUser
      ? [...current, optimisticUser, optimisticAssistant]
      : [...current, optimisticAssistant]
    );
    setConversationPending(true);
    streamActive.current = true;
    setConversationError(null);
    try {
      const response = await api.streamRunMessage(
        runId,
        content,
        (delta) => setMessages((current) => current.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + delta }
            : message
        )),
        appendUser,
      );
      const conversation = await api.getRunConversation(runId);
      setMessages(conversation.messages);
      setReportVersion(response.report_version);
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setConversationError(reason instanceof Error ? reason.message : "消息发送失败");
      replyRequested.current = false;
    } finally {
      streamActive.current = false;
      setConversationPending(false);
    }
  }, [runId]);

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
        if (!streamActive.current) setMessages(conversation.messages);
        setReportVersion(conversation.report_version);
        const latestMessage = conversation.messages.at(-1);
        if (latestMessage?.role === "user" && !replyRequested.current && !streamActive.current) {
          replyRequested.current = true;
          void streamReply(latestMessage.content, false);
        }
        if (nextRun.status === "queued" && !startRequested.current) {
          startRequested.current = true;
          void api.startRun(runId).then(refresh).catch((reason) => {
            if (active) setLoadError(reason instanceof Error ? reason.message : "研究启动失败");
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
        if (active) setLoadError(reason instanceof Error ? reason.message : "运行加载失败");
      }
    }

    refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, streamReply]);

  if (loadError) return <div className="error-banner">{loadError}</div>;
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
        <ResearchConversation
          messages={messages}
          pending={conversationPending}
          canRevise={run.status === "completed" && Boolean(report)}
          reportVersion={reportVersion}
          error={conversationError}
          onSend={sendMessage}
        />
        <RunWorkspaceView run={run} report={report} />
      </div>
    </>
  );

  async function sendMessage(content: string, action: "discuss" | "revise_report") {
    if (action === "discuss") {
      await streamReply(content, true);
      return;
    }
    setConversationPending(true);
    setConversationError(null);
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
      setConversationError(reason instanceof Error ? reason.message : "消息发送失败");
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
