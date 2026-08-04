"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FilePenLine,
  Gauge,
  Hand,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import type { ConversationModel, RunConversationMessage, RunOperation } from "../lib/api";
import { mergeRunTimeline } from "../lib/run-timeline";
import { OperationCard } from "./operation-card";

interface ResearchConversationProps {
  messages: RunConversationMessage[];
  operations: RunOperation[];
  pending: boolean;
  canRevise: boolean;
  reportVersion: number;
  error?: string | null;
  model?: ConversationModel;
  onModelChange?: (model: ConversationModel) => void;
  onSend: (content: string, action: "discuss" | "revise_report") => Promise<void>;
  onRetry?: () => void;
}

type PermissionMode = "ask" | "approve" | "full";

const permissionOptions = [
  { value: "ask", label: "请求批准", description: "执行扩展操作前始终询问", icon: Hand },
  { value: "approve", label: "替我审批", description: "仅对风险操作请求批准", icon: Gauge },
  { value: "full", label: "完全访问权限", description: "允许已启用的扩展能力", icon: ShieldCheck },
] as const;

export function ResearchConversation({
  messages,
  operations,
  pending,
  canRevise,
  reportVersion,
  error,
  model = "deepseek-v4-pro",
  onModelChange = () => undefined,
  onSend,
  onRetry,
}: ResearchConversationProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const actionMenu = useRef<HTMLDetailsElement>(null);
  const permissionMenu = useRef<HTMLDetailsElement>(null);
  const [content, setContent] = useState("");
  const [action, setAction] = useState<"discuss" | "revise_report">("discuss");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const saved = window.localStorage.getItem("paperpilot.permissionMode");
    return saved === "ask" || saved === "full" ? saved : "approve";
  });
  const timeline = mergeRunTimeline(messages, operations);
  const selectedPermission = permissionOptions.find((option) => option.value === permissionMode)!;
  const canSwitchDeepSeekModel = model === "deepseek-v4-flash" || model === "deepseek-v4-pro";

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, pending]);

  useEffect(() => {
    window.localStorage.setItem("paperpilot.permissionMode", permissionMode);
  }, [permissionMode]);

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
        {timeline.length === 0 ? (
          <div className="conversation-empty">
            <Bot size={20} aria-hidden="true" />
            <p>可以继续补充研究要求。研究完成后，对话会严格基于已纳入证据。</p>
          </div>
        ) : null}
        {timeline.map((entry) => entry.kind === "operation" ? (
          <OperationCard key={entry.id} operation={entry.operation} onRetry={onRetry} />
        ) : (
          <div
            className={`conversation-message message-${entry.message.role}${pending && entry.message === messages.at(-1) && entry.message.role === "assistant" ? " message-streaming" : ""}`}
            key={entry.id}
          >
            <span className="message-avatar" aria-hidden="true">
              {entry.message.role === "assistant" ? <Bot size={14} /> : <UserRound size={14} />}
            </span>
            <div>
              <strong>{entry.message.role === "assistant" ? "PaperPilot" : "你"}</strong>
              <p>
                {entry.message.content}
                {pending && entry.message === messages.at(-1) && entry.message.role === "assistant" ? (
                  entry.message.content ? <span className="stream-caret" aria-hidden="true" /> : (
                    <span className="stream-dots" aria-label="PaperPilot 正在生成回复">
                      <i /><i /><i />
                    </span>
                  )
                ) : null}
              </p>
              {entry.message.evidence_ids.length ? (
                <small>引用 {entry.message.evidence_ids.length} 条当前研究证据</small>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="conversation-compose">
        {error ? <p className="conversation-error" role="alert">{error}</p> : null}
        <div className="composer-input">
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
          <div className="composer-actions">
            <div className="composer-actions-left">
              <details
                className="composer-menu"
                ref={actionMenu}
                onToggle={(event) => {
                  if (event.currentTarget.open) permissionMenu.current?.removeAttribute("open");
                }}
              >
                <summary aria-label="添加"><Plus size={18} aria-hidden="true" /></summary>
                <div className="composer-popover action-popover">
                  <strong>消息处理</strong>
                  <button
                    className={action === "discuss" ? "selected" : ""}
                    type="button"
                    onClick={() => { setAction("discuss"); actionMenu.current!.open = false; }}
                  >
                    <MessageCircle size={17} aria-hidden="true" />
                    <span>讨论<small>基于当前研究证据回答</small></span>
                    {action === "discuss" ? <CheckCircle2 size={16} /> : null}
                  </button>
                  {canRevise ? (
                    <button
                      className={action === "revise_report" ? "selected" : ""}
                      type="button"
                      onClick={() => { setAction("revise_report"); actionMenu.current!.open = false; }}
                    >
                      <FilePenLine size={17} aria-hidden="true" />
                      <span>据此修订报告<small>将本次要求写入新报告版本</small></span>
                      {action === "revise_report" ? <CheckCircle2 size={16} /> : null}
                    </button>
                  ) : null}
                </div>
              </details>
              <details
                className="composer-menu permission-menu"
                ref={permissionMenu}
                onToggle={(event) => {
                  if (event.currentTarget.open) actionMenu.current?.removeAttribute("open");
                }}
              >
                <summary aria-label={`权限：${selectedPermission.label}`}>
                  <Gauge size={16} aria-hidden="true" />{selectedPermission.label}
                </summary>
                <div className="composer-popover permission-popover">
                  {permissionOptions.map((option) => {
                    const PermissionIcon = option.icon;
                    return (
                      <button
                        aria-label={option.label}
                        className={`${permissionMode === option.value ? "selected " : ""}permission-option-${option.value}`}
                        key={option.value}
                        type="button"
                        onClick={() => { setPermissionMode(option.value); permissionMenu.current!.open = false; }}
                      >
                        <PermissionIcon size={17} aria-hidden="true" />
                        <span>{option.label}<small>{option.description}</small></span>
                        {permissionMode === option.value ? <CheckCircle2 size={16} /> : null}
                      </button>
                    );
                  })}
                  <p>该偏好将用于后续扩展；当前研究流程不会申请额外系统权限。</p>
                </div>
              </details>
            </div>
            <div className="composer-actions-right">
              {action === "revise_report" ? <span className="composer-action-label"><FilePenLine size={13} />修订报告</span> : null}
              {canSwitchDeepSeekModel ? (
                <label className="composer-model">
                  <span className="visually-hidden">模型</span>
                  <select
                    aria-label="当前使用的模型"
                    value={model}
                    disabled={pending}
                    onChange={(event) => onModelChange(event.target.value as ConversationModel)}
                  >
                    <option value="deepseek-v4-flash">V4 Flash</option>
                    <option value="deepseek-v4-pro">V4 Pro</option>
                  </select>
                </label>
              ) : null}
              <button
                className="composer-send"
                type="button"
                onClick={() => void send()}
                disabled={!content.trim() || pending}
                aria-label="发送"
                title="发送"
              >
                <Send size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
