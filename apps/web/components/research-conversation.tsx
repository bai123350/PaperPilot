"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, FilePenLine, Send, UserRound } from "lucide-react";

import type { RunConversationMessage } from "../lib/api";

interface ResearchConversationProps {
  messages: RunConversationMessage[];
  pending: boolean;
  canRevise: boolean;
  reportVersion: number;
  error?: string | null;
  onSend: (content: string, action: "discuss" | "revise_report") => Promise<void>;
}

export function ResearchConversation({
  messages,
  pending,
  canRevise,
  reportVersion,
  error,
  onSend,
}: ResearchConversationProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState("");
  const [action, setAction] = useState<"discuss" | "revise_report">("discuss");

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, pending]);

  async function send() {
    const value = content.trim();
    if (!value || pending) return;
    setContent("");
    await onSend(value, action);
    setAction("discuss");
  }

  return (
    <aside className="run-conversation" aria-labelledby="run-conversation-title">
      <header className="conversation-header">
        <Bot size={18} aria-hidden="true" />
        <div>
          <h2 id="run-conversation-title">研究对话</h2>
          <p>{canRevise ? `报告版本 ${reportVersion}` : "随研究进度持续记录"}</p>
        </div>
      </header>

      <div ref={listRef} className="conversation-messages" aria-live="polite" aria-busy={pending}>
        {messages.length === 0 ? (
          <div className="conversation-empty">
            <Bot size={20} aria-hidden="true" />
            <p>可以继续补充研究要求。研究完成后，对话会严格基于已纳入证据。</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            className={`conversation-message message-${message.role}${pending && message === messages.at(-1) && message.role === "assistant" ? " message-streaming" : ""}`}
            key={message.id}
          >
            <span className="message-avatar" aria-hidden="true">
              {message.role === "assistant" ? <Bot size={14} /> : <UserRound size={14} />}
            </span>
            <div>
              <strong>{message.role === "assistant" ? "PaperPilot" : "你"}</strong>
              <p>
                {message.content}
                {pending && message === messages.at(-1) && message.role === "assistant" ? (
                  message.content ? <span className="stream-caret" aria-hidden="true" /> : (
                    <span className="stream-dots" aria-label="PaperPilot 正在生成回复">
                      <i /><i /><i />
                    </span>
                  )
                ) : null}
              </p>
              {message.evidence_ids.length ? (
                <small>引用 {message.evidence_ids.length} 条当前研究证据</small>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="conversation-compose">
        {error ? <p className="conversation-error" role="alert">{error}</p> : null}
        {canRevise ? (
          <div className="conversation-mode" aria-label="消息处理方式">
            <button
              className={action === "discuss" ? "active" : ""}
              type="button"
              onClick={() => setAction("discuss")}
            >
              讨论
            </button>
            <button
              className={action === "revise_report" ? "active" : ""}
              type="button"
              onClick={() => setAction("revise_report")}
            >
              <FilePenLine size={14} aria-hidden="true" />据此修订报告
            </button>
          </div>
        ) : null}
        <div className="conversation-input-row">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={3}
            maxLength={4000}
            placeholder={canRevise ? "追问证据，或说明希望如何完善报告" : "补充研究要求或询问当前进度"}
            aria-label="给研究助手发送消息"
          />
          <button
            className="assistant-send"
            type="button"
            onClick={() => void send()}
            disabled={!content.trim() || pending}
            aria-label="发送消息"
            title="发送消息"
          >
            <Send size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
