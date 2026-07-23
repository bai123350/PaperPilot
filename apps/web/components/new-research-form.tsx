"use client";

import { FormEvent, useRef, useState } from "react";
import { Bot, ChevronDown, LockKeyhole, Paperclip, Send, UserRound } from "lucide-react";

import type { ResearchAssistantMessage, ResearchBriefInput } from "../lib/api";

const welcomeMessage: ResearchAssistantMessage = {
  role: "assistant",
  content: "告诉我你想研究的生物医学问题。我会立即建立可持续对话的研究项目，并在后台检索、核对证据和生成报告。你可以随时继续补充范围、材料或要求。",
};

export function NewResearchForm({
  onSubmit,
}: {
  onSubmit: (
    brief: ResearchBriefInput,
    files: File[],
    messages: ResearchAssistantMessage[],
  ) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const form = formRef.current;
    const question = content.trim();
    if (!form || pending) return;
    if (question.length < 20) {
      setError("请用至少 20 个字符描述研究问题，以便建立稳定的研究范围");
      return;
    }

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

      <details className="research-options">
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

      {error ? <p className="assistant-error" role="alert">{error}</p> : null}
      <div className="research-chat-composer">
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
          rows={4}
          maxLength={2000}
          placeholder="描述你想探索的研究问题..."
          disabled={pending}
          autoFocus
        />
        <button
          className="assistant-send"
          type="submit"
          disabled={!content.trim() || pending}
          aria-label="发送研究问题"
          title="发送研究问题"
        >
          <Send size={17} aria-hidden="true" />
        </button>
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
