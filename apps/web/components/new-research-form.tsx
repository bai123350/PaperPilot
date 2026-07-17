"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Paperclip } from "lucide-react";

import type { ResearchBriefInput } from "../lib/api";

export function NewResearchForm({
  onSubmit,
}: {
  onSubmit: (brief: ResearchBriefInput, files: File[]) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    const list = (key: string) => value(key).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    try {
      const files = data
        .getAll("files")
        .filter((item): item is File => item instanceof File && item.size > 0);
      await onSubmit({
        question: value("question"),
        population: value("population") || undefined,
        intervention: value("intervention") || undefined,
        comparison: value("comparison") || undefined,
        outcomes: list("outcomes"),
        keywords: list("keywords"),
        date_from: Number(value("date_from")) || undefined,
        date_to: Number(value("date_to")) || undefined,
      }, files);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "提交失败");
      setPending(false);
    }
  }

  return (
    <form className="research-form" onSubmit={submit}>
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

      <div className="privacy-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <span>未发表原文件任务完成后最多保留 24 小时</span>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "正在创建研究..." : "开始研究"}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function Field({ id, label, placeholder }: { id: string; label: string; placeholder: string }) {
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} placeholder={placeholder} />
    </div>
  );
}
