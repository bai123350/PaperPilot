import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FlaskConical,
  Printer,
  RotateCcw,
  Send,
  Settings,
  UserRound,
  X,
} from "lucide-react";

import type {
  ConversationMessage,
  EvidenceRecord,
  ExportFormat,
  Report,
  ResearchBrief,
  ResearchRun,
  RunOperation,
  RunSnapshot,
} from "./generated/contracts";
import "./workspace.css";

interface WorkspaceProps {
  projectName: string;
  run: ResearchRun | null;
  messages: ConversationMessage[];
  operations: RunOperation[];
  report: Report | null;
  reportUpdating?: boolean;
  pending?: boolean;
  onSend?: (content: string) => Promise<void> | void;
  onStart?: (brief: ResearchBrief) => Promise<void> | void;
  onExport?: (format: ExportFormat) => Promise<void> | void;
  failureReason?: string | null;
  onRetry?: () => Promise<void> | void;
  onOpenSettings?: () => void;
  rerunDraft?: ResearchBrief | null;
  onPrepareRerun?: () => void;
  onCancelRerun?: () => void;
  previousRuns?: RunSnapshot[];
  selectedRunId?: string | null;
  reportLoading?: boolean;
  onSelectRun?: (runId: string | null) => Promise<void> | void;
}

type TimelineEntry =
  | { kind: "message"; sequence: number; value: ConversationMessage }
  | { kind: "operation"; sequence: number; value: RunOperation };

export function Workspace({
  projectName,
  run,
  messages,
  operations,
  report,
  reportUpdating = false,
  pending = false,
  onSend,
  onStart,
  onExport,
  failureReason,
  onRetry,
  onOpenSettings,
  rerunDraft = null,
  onPrepareRerun,
  onCancelRerun,
  previousRuns = [],
  selectedRunId = null,
  reportLoading = false,
  onSelectRun,
}: WorkspaceProps) {
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<EvidenceRecord | null>(null);
  const [population, setPopulation] = useState("");
  const [intervention, setIntervention] = useState("");
  const [comparison, setComparison] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [keywords, setKeywords] = useState("");
  const [dateFrom, setDateFrom] = useState("2010");
  const [dateTo, setDateTo] = useState("");
  const [studyTypes, setStudyTypes] = useState("");
  const [briefError, setBriefError] = useState<string | null>(null);
  const timelineEnd = useRef<HTMLDivElement>(null);
  const canCompose = !run || run.status === "completed";
  const currentTimeline = useMemo<TimelineEntry[]>(
    () => createTimeline(messages, operations),
    [messages, operations],
  );
  const hasTimeline = previousRuns.length > 0 || currentTimeline.length > 0;
  useEffect(() => {
    timelineEnd.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [currentTimeline, previousRuns.length, rerunDraft]);
  useEffect(() => {
    if (!rerunDraft) return;
    setContent(rerunDraft.question);
    setPopulation(rerunDraft.population ?? "");
    setIntervention(rerunDraft.intervention ?? "");
    setComparison(rerunDraft.comparison ?? "");
    setOutcomes(rerunDraft.outcomes.join(", "));
    setKeywords(rerunDraft.keywords.join(", "));
    setDateFrom(rerunDraft.dateFrom?.toString() ?? "2010");
    setDateTo(rerunDraft.dateTo?.toString() ?? "");
    setStudyTypes(rerunDraft.studyTypes.join(", "));
    setBriefError(null);
  }, [rerunDraft]);

  async function submit() {
    const value = content.trim();
    if (!value || pending) return;
    if (run) {
      setContent("");
      await onSend?.(value);
      return;
    }

    const from = parseYear(dateFrom);
    const to = parseYear(dateTo);
    if (from === undefined || to === undefined) {
      setBriefError("年份必须是 1900–2100 之间的四位数字。");
      return;
    }
    if (from !== null && to !== null && from > to) {
      setBriefError("起始年份不能晚于结束年份。");
      return;
    }

    setBriefError(null);
    setContent("");
    await onStart?.({
      question: value,
      population: optionalText(population),
      intervention: optionalText(intervention),
      comparison: optionalText(comparison),
      outcomes: splitValues(outcomes),
      keywords: splitValues(keywords),
      dateFrom: from,
      dateTo: to,
      studyTypes: splitValues(studyTypes),
    });
  }

  function showEvidence(ids: string[]) {
    const match = report?.evidence.find((item) => ids.includes(item.id));
    if (match) setEvidence(match);
  }

  return (
    <main className="desktop-workspace" data-testid="workspace">
      <section className="conversation-pane" aria-labelledby="conversation-title">
        <header className="pane-header">
          <div>
            <span className="pane-kicker">{projectName}</span>
            <h2 id="conversation-title">研究对话</h2>
          </div>
          <div className="pane-header-actions">
            {run?.status === "completed" && onPrepareRerun ? (
              <button className="rerun-button" type="button" onClick={onPrepareRerun}>
                <RotateCcw size={14} aria-hidden="true" />重新运行
              </button>
            ) : null}
            {rerunDraft && onCancelRerun ? (
              <button className="rerun-button rerun-cancel" type="button" onClick={onCancelRerun}>
                取消重跑
              </button>
            ) : null}
            <span className={`run-status status-${run?.status ?? "ready"}`}>
              {rerunDraft
                ? "修改参数"
                : run
                  ? `${run.status === "completed" ? "报告" : "运行"} ${run.progress}%`
                  : "准备开始"}
            </span>
          </div>
        </header>

        <div className="conversation-timeline" aria-live="polite">
          {rerunDraft ? (
            <div className="rerun-notice">
              <RotateCcw size={15} aria-hidden="true" />
              <div>
                <strong>修改后重新运行</strong>
                <p>下面保留此前全部记录；修改预填参数并提交后，将新增一次运行。</p>
              </div>
            </div>
          ) : null}
          {!hasTimeline ? (
            <div className="conversation-empty">
              <Bot size={24} aria-hidden="true" />
              <strong>{rerunDraft ? "修改后重新运行" : "从研究问题开始"}</strong>
              <p>
                {rerunDraft
                  ? "原研究问题和参数已预填。修改有误的条件后提交，将重新检索并生成一份新报告。"
                  : "输入问题后，PaperPilot 会持续返回检索、证据抽取和综合结果。"}
              </p>
            </div>
          ) : null}
          {previousRuns.length ? (
            <section className="run-history" aria-label="历史运行">
              <header className="run-history-header">
                <strong>历史记录</strong>
                <span>{previousRuns.length} 次运行 · 点击展开</span>
              </header>
              {previousRuns.map((snapshot, index) => (
                <details
                  className="history-run"
                  data-selected={selectedRunId === snapshot.run.id || undefined}
                  key={snapshot.run.id}
                >
                  <summary onClick={() => void onSelectRun?.(snapshot.run.id)}>
                    <span className="history-run-index">第 {index + 1} 次</span>
                    <span className="history-run-question">{snapshot.brief.question}</span>
                    <span className="history-run-counts">
                      {snapshot.messages.length} 条对话 · {snapshot.operations.length} 个步骤
                    </span>
                    <time>{new Date(snapshot.run.createdAt).toLocaleString("zh-CN")}</time>
                  </summary>
                  <div className="history-run-content">
                    <TimelineItems
                      entries={createTimeline(snapshot.messages, snapshot.operations)}
                      onEvidence={showEvidence}
                    />
                  </div>
                </details>
              ))}
            </section>
          ) : null}
          {run && previousRuns.length ? (
            <button
              className="run-divider current-run-divider"
              data-selected={!selectedRunId || undefined}
              type="button"
              onClick={() => void onSelectRun?.(null)}
            >
              <span>当前运行 · 第 {previousRuns.length + 1} 次</span>
              <time>{new Date(run.createdAt).toLocaleString("zh-CN")}</time>
            </button>
          ) : null}
          <TimelineItems entries={currentTimeline} onEvidence={showEvidence} />
          <div className="timeline-end" ref={timelineEnd} aria-hidden="true" />
        </div>

        <details className="research-options">
          <summary>研究参数与 PDF</summary>
          <div className="option-grid">
            <label>人群（P）<input value={population} onChange={(event) => setPopulation(event.target.value)} placeholder="可选研究人群" /></label>
            <label>干预/暴露（I）<input value={intervention} onChange={(event) => setIntervention(event.target.value)} placeholder="可选干预或暴露" /></label>
            <label>对照（C）<input value={comparison} onChange={(event) => setComparison(event.target.value)} placeholder="可选对照" /></label>
            <label>结局（O）<input value={outcomes} onChange={(event) => setOutcomes(event.target.value)} placeholder="以逗号分隔" /></label>
            <label>关键词<input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="以逗号分隔" /></label>
            <label>研究类型<input value={studyTypes} onChange={(event) => setStudyTypes(event.target.value)} placeholder="队列、RCT…" /></label>
            <label>起始年份<input inputMode="numeric" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} placeholder="2010" /></label>
            <label>结束年份<input inputMode="numeric" value={dateTo} onChange={(event) => setDateTo(event.target.value)} placeholder="留空表示最新" /></label>
          </div>
          <label className="pdf-drop">拖入文本型 PDF，或点击选择文件<input type="file" accept=".pdf,application/pdf" /></label>
          {briefError ? <p className="brief-error" role="alert">{briefError}</p> : null}
        </details>
        <div className="composer">
          <textarea
            aria-label={run ? "继续研究对话" : "输入研究问题"}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              run?.status === "completed"
                ? "追问证据或描述新的研究约束…"
                : rerunDraft
                  ? "修改研究问题后重新运行…"
                : run
                  ? "研究运行中，完成后可继续追问…"
                  : "输入研究问题…"
            }
            disabled={pending || !canCompose}
          />
          <button type="button" onClick={() => void submit()} disabled={!content.trim() || pending || !canCompose} aria-label="发送">
            <Send size={17} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="report-pane" aria-label="研究报告">
        {reportLoading ? (
          <div className="report-waiting" role="status">
            <span><FileText size={26} aria-hidden="true" /></span>
            <h2>正在加载历史报告</h2>
            <p>正在从本地加密存储读取所选运行的完整报告…</p>
          </div>
        ) : report ? (
          <ReportDocument
            report={report}
            updating={reportUpdating}
            onEvidence={showEvidence}
            onExport={onExport}
            exportDisabled={pending}
          />
        ) : run?.status === "failed" ? (
          <div className="report-waiting report-failed">
            <span><X size={26} aria-hidden="true" /></span>
            <h2>研究运行失败</h2>
            <p>{failureReason ?? "未生成演示或占位报告。请检查模型设置和网络连接后重新运行。"}</p>
            <div className="failure-actions">
              <button type="button" onClick={onOpenSettings}><Settings size={15} />模型设置</button>
              <button type="button" onClick={() => void onRetry?.()} disabled={pending}>
                <RotateCcw size={15} />重新运行
              </button>
            </div>
          </div>
        ) : (
          <div className="report-waiting">
            <span><FileText size={26} aria-hidden="true" /></span>
            <h2>报告生成中</h2>
            <p>右侧暂不展示零散草稿。引用审计完成后，将一次呈现完整报告。</p>
            <div className="report-progress"><i style={{ width: `${run?.progress ?? 0}%` }} /></div>
          </div>
        )}
        {evidence ? <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} /> : null}
      </section>
    </main>
  );
}

function createTimeline(
  messages: ConversationMessage[],
  operations: RunOperation[],
): TimelineEntry[] {
  return [
    ...messages.map(
      (value): TimelineEntry => ({ kind: "message", sequence: value.sequence, value }),
    ),
    ...operations.map(
      (value): TimelineEntry => ({ kind: "operation", sequence: value.sequence, value }),
    ),
  ].sort((left, right) => left.sequence - right.sequence);
}

function TimelineItems({
  entries,
  onEvidence,
}: {
  entries: TimelineEntry[];
  onEvidence: (ids: string[]) => void;
}) {
  return entries.map((entry) =>
    entry.kind === "operation" ? (
      <article className={`operation operation-${entry.value.status}`} key={entry.value.id}>
        <span className="operation-icon">
          {entry.value.status === "completed" ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : entry.value.status === "failed" ? (
            <X size={16} aria-hidden="true" />
          ) : (
            <Clock3 size={16} aria-hidden="true" />
          )}
        </span>
        <div>
          <header>
            <strong>{entry.value.title}</strong>
            <span>
              {entry.value.status === "completed"
                ? "完成"
                : entry.value.status === "failed"
                  ? "失败"
                  : "执行中"}
            </span>
          </header>
          <p><OperationText text={entry.value.summary} /></p>
        </div>
      </article>
    ) : (
      <article className={`message message-${entry.value.role}`} key={entry.value.id}>
        <span className="message-avatar">
          {entry.value.role === "user" ? (
            <UserRound size={15} aria-hidden="true" />
          ) : (
            <Bot size={15} aria-hidden="true" />
          )}
        </span>
        <div>
          <strong>{entry.value.role === "user" ? "你" : "PaperPilot"}</strong>
          <p>{formatMessageContent(entry.value)}</p>
          {entry.value.evidenceIds.length ? (
            <button
              className="evidence-link"
              type="button"
              onClick={() => onEvidence(entry.value.evidenceIds)}
            >
              查看 {entry.value.evidenceIds.length} 条证据
            </button>
          ) : null}
        </div>
      </article>
    ),
  );
}

function OperationText({ text }: { text: string }) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => {
    if (!/^https?:\/\//.test(part)) return <span key={`${index}-${part}`}>{part}</span>;
    return (
      <a
        className="paper-id-link"
        href={part}
        key={`${index}-${part}`}
        rel="noreferrer"
        target="_blank"
        onClick={(event) => {
          event.preventDefault();
          void openUrl(part);
        }}
      >
        打开 Google Scholar
      </a>
    );
  });
}

function formatMessageContent(message: ConversationMessage): string {
  if (
    message.role === "assistant" &&
    /^已依据检索证据生成报告[：:]/.test(message.content.trimStart())
  ) {
    return "本次报告已生成（完整内容见右侧报告）";
  }
  return message.content;
}

function ReportDocument({
  report,
  updating,
  onEvidence,
  onExport,
  exportDisabled,
}: {
  report: Report;
  updating: boolean;
  onEvidence: (ids: string[]) => void;
  onExport?: (format: ExportFormat) => Promise<void> | void;
  exportDisabled: boolean;
}) {
  return (
    <article className="report-document">
      <header className="report-header">
        <div><span className="pane-kicker">完整报告 · v{report.version}</span><h1>{report.title}</h1></div>
        <div className="report-actions">
          {updating ? <span className="report-updating">更新中</span> : null}
          <button type="button" disabled={exportDisabled} onClick={() => void onExport?.("markdown")}><Download size={15} aria-hidden="true" />Markdown</button>
          <button type="button" disabled={exportDisabled} onClick={() => void onExport?.("print_html")}><Printer size={15} aria-hidden="true" />打印</button>
        </div>
      </header>
      <p className="report-summary">
        <EvidenceText text={report.summary} evidence={report.evidence} onEvidence={onEvidence} />
      </p>
      <ReportSection title="进展时间线">
        <ol className="report-timeline">
          {report.timeline.map((item, index) => {
            const parsed = item.match(/^((?:19|20)\d{2}(?:[–—-](?:19|20)\d{2})?)[：:]\s*(.*)$/);
            const studies = splitTimelineStudies(parsed?.[2] ?? item);
            return (
              <li key={`${index}-${item}`}>
                <time>{parsed?.[1] ?? "阶段"}</time>
                <div className="timeline-studies">
                  {studies.map((study, studyIndex) => (
                    <p key={`${studyIndex}-${study}`}>
                      <EvidenceText text={study} evidence={report.evidence} onEvidence={onEvidence} />
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </ReportSection>
      <ReportSection title="主题版图">
        <ul>{report.themes.map((item) => <li key={item}><EvidenceText text={item} evidence={report.evidence} onEvidence={onEvidence} /></li>)}</ul>
      </ReportSection>
      <ReportSection title="主要结论">
        {report.claims.map((claim) => (
          <div className="claim" key={claim.id}>
            <CheckCircle2 size={17} aria-hidden="true" />
            <div><p><EvidenceText text={claim.statement} evidence={report.evidence} onEvidence={onEvidence} /></p><button className="evidence-link" type="button" onClick={() => onEvidence(claim.evidenceIds)}>查看 {claim.evidenceIds.length} 条证据</button></div>
          </div>
        ))}
      </ReportSection>
      <ReportSection title="争议与局限">
        <ul>{[...report.controversies, ...report.limitations].map((item) => <li key={item}><EvidenceText text={item} evidence={report.evidence} onEvidence={onEvidence} /></li>)}</ul>
      </ReportSection>
      <ReportSection title="研究空白">
        <ul>{report.gaps.map((item) => <li key={item}><EvidenceText text={item} evidence={report.evidence} onEvidence={onEvidence} /></li>)}</ul>
      </ReportSection>
      <ReportSection title="三个下一步方案">
        <div className="recommendation-grid">
          {report.recommendations.map((item, index) => (
            <article className="recommendation-card" data-testid="recommendation-card" key={item.id}>
              <span>0{index + 1}</span><FlaskConical size={20} aria-hidden="true" />
              <h3><EvidenceText text={item.title} evidence={report.evidence} onEvidence={onEvidence} /></h3>
              <p><EvidenceText text={item.rationale} evidence={report.evidence} onEvidence={onEvidence} /></p>
              <dl><div><dt>可检验假设</dt><dd><EvidenceText text={item.hypothesis} evidence={report.evidence} onEvidence={onEvidence} /></dd></div><div><dt>最小验证</dt><dd><EvidenceText text={item.minimalValidation} evidence={report.evidence} onEvidence={onEvidence} /></dd></div><div><dt>数据与资源</dt><dd><EvidenceText text={item.resources.join("、")} evidence={report.evidence} onEvidence={onEvidence} /></dd></div><div><dt>风险</dt><dd><EvidenceText text={item.risks.join("、")} evidence={report.evidence} onEvidence={onEvidence} /></dd></div><div><dt>停止条件</dt><dd><EvidenceText text={item.stopCondition} evidence={report.evidence} onEvidence={onEvidence} /></dd></div></dl>
              <button className="evidence-link" type="button" onClick={() => onEvidence(item.evidenceIds)}>查看 {item.evidenceIds.length} 条证据</button>
            </article>
          ))}
        </div>
      </ReportSection>
      <ReportSection title="参考文献">
        <ol>{report.references.map((item) => <li key={item}><ReferenceText reference={item} evidence={report.evidence} /></li>)}</ol>
      </ReportSection>
      <footer className="report-disclaimer">{report.disclaimer}</footer>
    </article>
  );
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function splitValues(value: string): string[] {
  return value
    .split(/[,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseYear(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d{4}$/.test(normalized)) return undefined;
  const year = Number(normalized);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

export function splitTimelineStudies(value: string): string[] {
  const studies = value
    .split(/\r?\n|[;；]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  return studies.length > 0 ? studies : [value];
}

function EvidenceText({
  text,
  evidence,
  onEvidence,
}: {
  text: string;
  evidence: EvidenceRecord[];
  onEvidence: (ids: string[]) => void;
}) {
  return text.split(/(\bevidence-\d+\b)/gi).map((part, index) => {
    if (!/^evidence-\d+$/i.test(part)) return <span key={`${index}-${part}`}>{part}</span>;
    const record = evidence.find((item) => {
      const id = item.id.toLowerCase();
      const token = part.toLowerCase();
      return id === token || id.endsWith(`-${token}`);
    });
    if (!record) return <span key={`${index}-${part}`}>{part}</span>;
    return (
      <button
        aria-label={`打开证据 ${part}`}
        className="inline-evidence-link"
        key={`${index}-${part}`}
        type="button"
        onClick={() => onEvidence([record.id])}
      >
        {part}
      </button>
    );
  });
}

function ReferenceText({
  reference,
  evidence,
}: {
  reference: string;
  evidence: EvidenceRecord[];
}) {
  const record = evidence.find((item) => reference.endsWith(`(${item.paperId})`));
  if (!record) return <>{reference}</>;
  const suffix = `(${record.paperId})`;
  return (
    <>
      {reference.slice(0, -suffix.length)}
      (<PaperIdentifier paperId={record.paperId} />)
    </>
  );
}

function PaperIdentifier({ paperId }: { paperId: string }) {
  const url = paperIdentifierUrl(paperId);
  if (!url) return <>{paperId}</>;
  return (
    <a
      className="paper-id-link"
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openUrl(url);
      }}
    >
      {paperId}
    </a>
  );
}

export function paperIdentifierUrl(paperId: string): string | null {
  const separator = paperId.indexOf(":");
  if (separator < 1) return null;
  const kind = paperId.slice(0, separator).toLowerCase();
  const value = paperId.slice(separator + 1).trim();
  if (!value) return null;
  if (kind === "pmid") return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(value)}/`;
  if (kind === "pmcid") return `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(value)}/`;
  if (kind === "doi") return `https://doi.org/${value}`;
  if (kind === "openalex") return `https://openalex.org/${encodeURIComponent(value)}`;
  return null;
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="report-section"><h2>{title}</h2>{children}</section>;
}

function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceRecord; onClose: () => void }) {
  return (
    <aside className="evidence-drawer" aria-label="证据详情">
      <header><div><span className="pane-kicker">Evidence Record</span><h2>{evidence.paperTitle}</h2></div><button type="button" onClick={onClose} aria-label="关闭证据"><X size={18} /></button></header>
      <blockquote>{evidence.excerpt}</blockquote>
      <dl><div><dt>定位</dt><dd>{evidence.locator}</dd></div><div><dt>论文标识</dt><dd><PaperIdentifier paperId={evidence.paperId} /></dd></div><div><dt>证据类型</dt><dd>{evidence.evidenceType}</dd></div><div><dt>置信度</dt><dd>{Math.round(evidence.confidence * 100)}%</dd></div></dl>
    </aside>
  );
}
