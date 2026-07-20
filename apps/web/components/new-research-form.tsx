"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, LockKeyhole, Paperclip, Send, UserRound } from "lucide-react";

import type { ResearchAssistantMessage, ResearchBriefInput } from "../lib/api";

const welcomeMessage: ResearchAssistantMessage = {
  role: "assistant",
  content: "我会结合上方的研究问题和 PICO 信息，帮你澄清范围、补充关键词或检查研究设计。填写研究问题后，可以直接告诉我你还不确定的地方。",
};

export function NewResearchForm({
  onSubmit,
  onAssist,
}: {
  onSubmit: (
    brief: ResearchBriefInput,
    files: File[],
    messages: ResearchAssistantMessage[],
  ) => Promise<void>;
  onAssist: (
    brief: ResearchBriefInput,
    messages: ResearchAssistantMessage[],
  ) => Promise<ResearchAssistantMessage>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantPending, setAssistantPending] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ResearchAssistantMessage[]>([welcomeMessage]);

  useEffect(() => {
    const messageList = messagesRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [messages, assistantPending]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const files = data
        .getAll("files")
        .filter((item): item is File => item instanceof File && item.size > 0);
      await onSubmit(toBrief(data), files, messages);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "提交失败");
      setPending(false);
    }
  }

  async function askAssistant() {
    const form = formRef.current;
    const content = assistantInput.trim();
    if (!form || !content || assistantPending) return;

    if (!form.reportValidity()) {
      setAssistantError("请先填写至少 20 个字符的研究问题，再开始讨论");
      return;
    }

    const userMessage: ResearchAssistantMessage = { role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setAssistantInput("");
    setAssistantError(null);
    setAssistantPending(true);
    try {
      const reply = await onAssist(toBrief(new FormData(form)), nextMessages);
      setMessages((current) => [...current, reply]);
    } catch (reason) {
      setAssistantError(reason instanceof Error ? reason.message : "研究助手回复失败");
    } finally {
      setAssistantPending(false);
    }
  }

  return (
    <form ref={formRef} className="research-form" onSubmit={submit}>
      <div className="form-section form-section-primary">
        <label htmlFor="question">研究问题</label>
        <textarea
          id="question"
          name="question"
          minLength={20}
          maxLength={2000}
          rows={5}
          required
          placeholder="例如：循环肿瘤 DNA 在晚期结直肠癌治疗响应预测中的证据如何？"
        />
      </div>

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

      <section className="research-assistant" aria-labelledby="research-assistant-title">
        <div className="assistant-heading">
          <Bot size={19} aria-hidden="true" />
          <div>
            <h2 id="research-assistant-title">研究问题助手</h2>
            <p>围绕当前填写内容继续讨论</p>
          </div>
        </div>
        <div
          ref={messagesRef}
          className="assistant-messages"
          aria-live="polite"
          aria-busy={assistantPending}
        >
          {messages.map((message, index) => (
            <div className={`assistant-message message-${message.role}`} key={`${message.role}-${index}`}>
              <span className="message-avatar" aria-hidden="true">
                {message.role === "assistant" ? <Bot size={15} /> : <UserRound size={15} />}
              </span>
              <div><strong>{message.role === "assistant" ? "PaperPilot" : "你"}</strong><p>{message.content}</p></div>
            </div>
          ))}
          {assistantPending ? (
            <div className="assistant-message message-assistant assistant-thinking">
              <span className="message-avatar" aria-hidden="true"><Bot size={15} /></span>
              <div><strong>PaperPilot</strong><p>正在结合当前研究内容分析<span aria-hidden="true">...</span></p></div>
            </div>
          ) : null}
        </div>
        {assistantError ? <p className="assistant-error" role="alert">{assistantError}</p> : null}
        <div className="assistant-composer">
          <textarea
            aria-label="给研究问题助手发送消息"
            value={assistantInput}
            onChange={(event) => setAssistantInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void askAssistant();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="例如：这个问题的范围是否太宽？"
          />
          <button
            className="assistant-send"
            type="button"
            onClick={() => void askAssistant()}
            disabled={!assistantInput.trim() || assistantPending}
            aria-label="发送消息"
            title="发送消息"
          >
            <Send size={17} aria-hidden="true" />
          </button>
        </div>
      </section>

      <div className="privacy-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <span>对话仅用于完善当前研究；未发表原文件任务完成后最多保留 24 小时</span>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={pending || assistantPending}>
          {pending ? "正在创建研究..." : "开始研究"}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function toBrief(data: FormData): ResearchBriefInput {
  const value = (key: string) => String(data.get(key) ?? "").trim();
  const list = (key: string) => value(key).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  return {
    question: value("question"),
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
