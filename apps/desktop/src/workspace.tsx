import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  FlaskConical,
  Send,
  UserRound,
  X,
} from "lucide-react";

import type {
  ConversationMessage,
  EvidenceRecord,
  Report,
  ResearchRun,
  RunOperation,
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
  onStart?: (question: string) => Promise<void> | void;
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
}: WorkspaceProps) {
  const [content, setContent] = useState("");
  const [evidence, setEvidence] = useState<EvidenceRecord | null>(null);
  const timeline = useMemo<TimelineEntry[]>(
    () =>
      [
        ...messages.map(
          (value): TimelineEntry => ({ kind: "message", sequence: value.sequence, value }),
        ),
        ...operations.map(
          (value): TimelineEntry => ({ kind: "operation", sequence: value.sequence, value }),
        ),
      ].sort((left, right) => left.sequence - right.sequence),
    [messages, operations],
  );

  async function submit() {
    const value = content.trim();
    if (!value || pending) return;
    setContent("");
    if (run) await onSend?.(value);
    else await onStart?.(value);
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
          <span className={`run-status status-${run?.status ?? "ready"}`}>
            {run ? `${run.status === "completed" ? "报告" : "运行"} ${run.progress}%` : "准备开始"}
          </span>
        </header>

        <div className="conversation-timeline" aria-live="polite">
          {!timeline.length ? (
            <div className="conversation-empty">
              <Bot size={24} aria-hidden="true" />
              <strong>从研究问题开始</strong>
              <p>输入问题后，PaperPilot 会持续返回检索、证据抽取和综合结果。</p>
            </div>
          ) : null}
          {timeline.map((entry) =>
            entry.kind === "operation" ? (
              <article className={`operation operation-${entry.value.status}`} key={entry.value.id}>
                <span className="operation-icon">
                  {entry.value.status === "completed" ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    <Clock3 size={16} aria-hidden="true" />
                  )}
                </span>
                <div>
                  <strong>{entry.value.title}</strong>
                  <p>{entry.value.summary}</p>
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
                  <p>{entry.value.content}</p>
                  {entry.value.evidenceIds.length ? (
                    <button
                      className="evidence-link"
                      type="button"
                      onClick={() => showEvidence(entry.value.evidenceIds)}
                    >
                      查看 {entry.value.evidenceIds.length} 条证据
                    </button>
                  ) : null}
                </div>
              </article>
            ),
          )}
        </div>

        <details className="research-options">
          <summary>研究参数与 PDF</summary>
          <div className="option-grid">
            <label>PICO / 人群<input placeholder="可选研究人群" /></label>
            <label>关键词<input placeholder="以逗号分隔" /></label>
            <label>年份<input placeholder="2020–2026" /></label>
            <label>研究类型<input placeholder="队列、RCT…" /></label>
          </div>
          <label className="pdf-drop">拖入文本型 PDF，或点击选择文件<input type="file" accept=".pdf,application/pdf" /></label>
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
            placeholder={run ? "追问证据或描述新的研究约束…" : "输入研究问题…"}
          />
          <button type="button" onClick={() => void submit()} disabled={!content.trim() || pending} aria-label="发送">
            <Send size={17} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="report-pane" aria-label="研究报告">
        {report ? (
          <ReportDocument report={report} updating={reportUpdating} onEvidence={showEvidence} />
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

function ReportDocument({
  report,
  updating,
  onEvidence,
}: {
  report: Report;
  updating: boolean;
  onEvidence: (ids: string[]) => void;
}) {
  return (
    <article className="report-document">
      <header className="report-header">
        <div><span className="pane-kicker">完整报告 · v{report.version}</span><h1>{report.title}</h1></div>
        {updating ? <span className="report-updating">更新中</span> : null}
      </header>
      <p className="report-summary">{report.summary}</p>
      <ReportSection title="主要结论">
        {report.claims.map((claim) => (
          <div className="claim" key={claim.id}>
            <CheckCircle2 size={17} aria-hidden="true" />
            <div><p>{claim.statement}</p><button className="evidence-link" type="button" onClick={() => onEvidence(claim.evidenceIds)}>查看 {claim.evidenceIds.length} 条证据</button></div>
          </div>
        ))}
      </ReportSection>
      <ReportSection title="争议与局限">
        <ul>{[...report.controversies, ...report.limitations].map((item) => <li key={item}>{item}</li>)}</ul>
      </ReportSection>
      <ReportSection title="研究空白">
        <ul>{report.gaps.map((item) => <li key={item}>{item}</li>)}</ul>
      </ReportSection>
      <ReportSection title="三个下一步方案">
        <div className="recommendation-grid">
          {report.recommendations.map((item, index) => (
            <article className="recommendation-card" data-testid="recommendation-card" key={item.id}>
              <span>0{index + 1}</span><FlaskConical size={20} aria-hidden="true" />
              <h3>{item.title}</h3><p>{item.rationale}</p>
              <dl><div><dt>可检验假设</dt><dd>{item.hypothesis}</dd></div><div><dt>最小验证</dt><dd>{item.minimalValidation}</dd></div><div><dt>停止条件</dt><dd>{item.stopCondition}</dd></div></dl>
              <button className="evidence-link" type="button" onClick={() => onEvidence(item.evidenceIds)}>查看 {item.evidenceIds.length} 条证据</button>
            </article>
          ))}
        </div>
      </ReportSection>
      <footer className="report-disclaimer">{report.disclaimer}</footer>
    </article>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="report-section"><h2>{title}</h2>{children}</section>;
}

function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceRecord; onClose: () => void }) {
  return (
    <aside className="evidence-drawer" aria-label="证据详情">
      <header><div><span className="pane-kicker">Evidence Record</span><h2>{evidence.paperTitle}</h2></div><button type="button" onClick={onClose} aria-label="关闭证据"><X size={18} /></button></header>
      <blockquote>{evidence.excerpt}</blockquote>
      <dl><div><dt>定位</dt><dd>{evidence.locator}</dd></div><div><dt>论文标识</dt><dd>{evidence.paperId}</dd></div><div><dt>证据类型</dt><dd>{evidence.evidenceType}</dd></div><div><dt>置信度</dt><dd>{Math.round(evidence.confidence * 100)}%</dd></div></dl>
    </aside>
  );
}
