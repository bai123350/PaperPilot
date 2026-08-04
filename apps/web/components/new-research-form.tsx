"use client";

import { FormEvent, useRef, useState, useSyncExternalStore } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Gauge,
  Hand,
  Lightbulb,
  LockKeyhole,
  Paperclip,
  Plus,
  Puzzle,
  Send,
  ShieldCheck,
  Target,
  UserRound,
} from "lucide-react";

import type {
  ConversationModel,
  ResearchAssistantMessage,
  ResearchBriefInput,
} from "../lib/api";

const welcomeMessage: ResearchAssistantMessage = {
  role: "assistant",
  content: "告诉我你想研究的生物医学问题。我会立即建立可持续对话的研究项目，并在后台检索、核对证据和生成报告。你可以随时继续补充范围、材料或要求。",
};

type PermissionMode = "ask" | "approve" | "full";
const permissionStorageKey = "paperpilot.permissionMode";
const permissionChangeEvent = "paperpilot:permission-mode-change";

const permissionOptions = [
  { value: "ask", label: "请求批准", description: "执行扩展操作前始终询问", icon: Hand },
  { value: "approve", label: "替我审批", description: "仅对风险操作请求批准", icon: Gauge },
  { value: "full", label: "完全访问权限", description: "允许已启用的扩展能力", icon: ShieldCheck },
] as const;

function readPermissionMode(): PermissionMode {
  const saved = window.localStorage.getItem(permissionStorageKey);
  return saved === "ask" || saved === "full" ? saved : "approve";
}

function subscribePermissionMode(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(permissionChangeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(permissionChangeEvent, onChange);
  };
}

function writePermissionMode(mode: PermissionMode): void {
  window.localStorage.setItem(permissionStorageKey, mode);
  window.dispatchEvent(new Event(permissionChangeEvent));
}

export function NewResearchForm({
  model = "deepseek-v4-pro",
  onModelChange = () => undefined,
  onSubmit,
}: {
  model?: ConversationModel;
  onModelChange?: (model: ConversationModel) => void;
  onSubmit: (
    brief: ResearchBriefInput,
    files: File[],
    messages: ResearchAssistantMessage[],
  ) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const addMenu = useRef<HTMLDetailsElement>(null);
  const permissionMenu = useRef<HTMLDetailsElement>(null);
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permissionMode = useSyncExternalStore(
    subscribePermissionMode,
    readPermissionMode,
    () => "approve",
  );
  const selectedPermission = permissionOptions.find((option) => option.value === permissionMode)!;
  const canSwitchDeepSeekModel = model === "deepseek-v4-flash" || model === "deepseek-v4-pro";

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const form = formRef.current;
    const question = content.trim();
    if (!form || pending || !question) return;

    setPending(true);
    setError(null);
    const data = new FormData(form);
    try {
      const files = data
        .getAll("files")
        .filter((item): item is File => item instanceof File && item.size > 0);
      const userMessage: ResearchAssistantMessage = { role: "user", content: question };
      await onSubmit(toBrief(data, question), files, [welcomeMessage, userMessage]);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "消息发送失败");
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="research-chat-start" onSubmit={send}>
      <div className="research-chat-messages" aria-live="polite">
        <div className="assistant-message message-assistant">
          <span className="message-avatar" aria-hidden="true"><Bot size={15} /></span>
          <div><strong>PaperPilot</strong><p>{welcomeMessage.content}</p></div>
        </div>
        {pending ? (
          <>
            <div className="assistant-message message-user">
              <span className="message-avatar" aria-hidden="true"><UserRound size={15} /></span>
              <div><strong>你</strong><p>{content.trim()}</p></div>
            </div>
            <div className="assistant-message message-assistant assistant-thinking">
              <span className="message-avatar" aria-hidden="true"><Bot size={15} /></span>
              <div><strong>PaperPilot</strong><p>正在建立研究上下文...</p></div>
            </div>
          </>
        ) : null}
      </div>

      <details className="research-options" ref={optionsRef}>
        <summary><ChevronDown size={16} aria-hidden="true" />研究设置与 PDF</summary>
        <div className="form-grid">
          <Field id="population" label="研究人群" placeholder="成人、特定癌种或治疗阶段" />
          <Field id="intervention" label="干预或暴露" placeholder="检测、治疗或风险因素" />
          <Field id="comparison" label="对照" placeholder="标准治疗、安慰剂或基线" />
          <Field id="outcomes" label="结局指标" placeholder="用逗号分隔" />
          <Field id="keywords" label="补充关键词" placeholder="同义词、缩写，用逗号分隔" />
          <div className="field-group date-range">
            <label htmlFor="date_from">发表年份</label>
            <div>
              <input id="date_from" name="date_from" inputMode="numeric" placeholder="2018" />
              <span>至</span>
              <input id="date_to" name="date_to" inputMode="numeric" placeholder="2026" />
            </div>
          </div>
        </div>
        <div className="upload-field">
          <Paperclip size={18} aria-hidden="true" />
          <div><label htmlFor="files">私密研究材料</label><small>PDF · 单文件最大 50 MB</small></div>
          <input id="files" name="files" type="file" accept="application/pdf,.pdf" multiple />
        </div>
      </details>

      <div className="conversation-compose research-chat-compose">
        {error ? <p className="conversation-error" role="alert">{error}</p> : null}
        <div className="composer-input">
          <textarea
            aria-label="给 PaperPilot 发送研究问题"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={3}
            maxLength={2000}
            placeholder="描述你想探索的研究问题..."
            disabled={pending}
            autoFocus
          />
          <div className="composer-actions">
            <div className="composer-actions-left">
              <details
                className="composer-menu"
                ref={addMenu}
                onToggle={(event) => {
                  if (event.currentTarget.open) permissionMenu.current?.removeAttribute("open");
                }}
              >
                <summary aria-label="添加"><Plus size={18} aria-hidden="true" /></summary>
                <div className="composer-popover add-popover">
                  <strong>添加</strong>
                  <button
                    type="button"
                    onClick={() => {
                      if (optionsRef.current) optionsRef.current.open = true;
                      addMenu.current?.removeAttribute("open");
                    }}
                  >
                    <Paperclip size={17} aria-hidden="true" />
                    <span>研究设置与 PDF<small>补充范围、年份和私密材料</small></span>
                  </button>
                  <button type="button" disabled>
                    <Target size={17} aria-hidden="true" />
                    <span>目标<small>即将支持</small></span>
                  </button>
                  <button type="button" disabled>
                    <Lightbulb size={17} aria-hidden="true" />
                    <span>计划模式<small>即将支持</small></span>
                  </button>
                  <div className="popover-section-title">插件</div>
                  <button type="button" disabled>
                    <Puzzle size={17} aria-hidden="true" />
                    <span>插件中心<small>后续可在这里添加插件</small></span>
                  </button>
                </div>
              </details>
              <details
                className="composer-menu permission-menu"
                ref={permissionMenu}
                onToggle={(event) => {
                  if (event.currentTarget.open) addMenu.current?.removeAttribute("open");
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
                        onClick={() => {
                          writePermissionMode(option.value);
                          permissionMenu.current?.removeAttribute("open");
                        }}
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
                type="submit"
                disabled={!content.trim() || pending}
                aria-label="发送研究问题"
                title="发送研究问题"
              >
                <Send size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="privacy-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <span>对话随项目持久保存；原始 PDF 在任务完成后最多保留 24 小时</span>
      </div>
    </form>
  );
}

function toBrief(data: FormData, question: string): ResearchBriefInput {
  const value = (key: string) => String(data.get(key) ?? "").trim();
  const list = (key: string) => value(key).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  return {
    question,
    population: value("population") || undefined,
    intervention: value("intervention") || undefined,
    comparison: value("comparison") || undefined,
    outcomes: list("outcomes"),
    keywords: list("keywords"),
    date_from: Number(value("date_from")) || undefined,
    date_to: Number(value("date_to")) || undefined,
  };
}

function Field({ id, label, placeholder }: { id: string; label: string; placeholder: string }) {
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} placeholder={placeholder} />
    </div>
  );
}
