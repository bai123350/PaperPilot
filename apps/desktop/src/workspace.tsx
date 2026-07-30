import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FlaskConical,
  Gauge,
  GitBranch,
  Hand,
  Lightbulb,
  Paperclip,
  Plus,
  Printer,
  Puzzle,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Target,
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
  onPause?: () => Promise<void> | void;
  pausePending?: boolean;
  onOpenSettings?: () => void;
  rerunDraft?: ResearchBrief | null;
  onPrepareRerun?: () => void;
  onCancelRerun?: () => void;
  previousRuns?: RunSnapshot[];
  selectedRunId?: string | null;
  reportLoading?: boolean;
  onSelectRun?: (runId: string | null) => Promise<void> | void;
  model?: string;
  modelOptions?: readonly { value: string; label: string }[];
  onModelChange?: (model: string) => Promise<void> | void;
}

type TimelineEntry =
  | { kind: "message"; sequence: number; value: ConversationMessage }
  | { kind: "operation"; sequence: number; value: RunOperation };

interface DirectionStudy {
  year: string;
  text: string;
}

interface ResearchDirection {
  id: string;
  label: string;
  description: string;
  studies: DirectionStudy[];
}

interface KnowledgeGraphDirectionNode extends ResearchDirection {
  x: number;
  y: number;
  color: string;
}

interface KnowledgeGraphPaperNode {
  id: string;
  title: string;
  summary: string;
  year: string;
  directionIds: string[];
  evidenceIds: string[];
  authors: string[];
  genes: string[];
  findings: string[];
  x: number;
  y: number;
  radius: number;
  isCore: boolean;
  score: number;
}

type KnowledgeGraphEntityKind = "author" | "gene" | "finding";

interface KnowledgeGraphEntityNode {
  id: string;
  kind: KnowledgeGraphEntityKind;
  label: string;
  paperIds: string[];
  x: number;
  y: number;
  radius: number;
}

interface KnowledgeGraphEdge {
  id: string;
  kind: "theme" | "association" | "progression" | KnowledgeGraphEntityKind;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

interface KnowledgeGraphLayout {
  directions: KnowledgeGraphDirectionNode[];
  papers: KnowledgeGraphPaperNode[];
  entities: KnowledgeGraphEntityNode[];
  edges: KnowledgeGraphEdge[];
}

type PermissionMode = "ask" | "approve" | "full";

const timelineItemPattern = /^((?:19|20)\d{2}(?:[–—-](?:19|20)\d{2})?)[：:]\s*(.*)$/;

const researchDirectionRules = [
  {
    id: "translation",
    label: "干预与转化",
    description: "药物、靶向干预与疗效验证",
    keywords: ["治疗", "干预", "药物", "抑制剂", "激动剂", "拮抗剂", "给药", "保护", "疗法", "靶向", "移植"],
  },
  {
    id: "clinical",
    label: "临床与人群证据",
    description: "患者样本、队列与临床关联",
    keywords: ["患者", "临床", "队列", "病例", "人群", "血清", "血浆", "样本", "预后", "诊断", "生物标志物", "抗体"],
  },
  {
    id: "methods",
    label: "模型与技术",
    description: "实验模型、组学与分析方法",
    keywords: ["模型", "小鼠", "大鼠", "动物", "体外", "细胞系", "测序", "组学", "成像", "图谱", "分析", "方法", "技术", "多模态"],
  },
  {
    id: "mechanism",
    label: "机制与通路",
    description: "细胞过程、分子机制与信号通路",
    keywords: ["机制", "通路", "信号", "受体", "蛋白", "基因", "炎症", "免疫", "细胞", "死亡", "激活", "表达", "分子", "病理", "神经"],
  },
] as const;

const knowledgeGraphSize = 1200;
const knowledgeGraphCenter = knowledgeGraphSize / 2;
const knowledgeGraphColors: Record<string, string> = {
  translation: "#c77752",
  clinical: "#5e86aa",
  methods: "#846ca1",
  mechanism: "#4f8c77",
  general: "#23906e",
};

const permissionOptions: {
  value: PermissionMode;
  label: string;
  description: string;
  icon: typeof Hand;
}[] = [
  {
    value: "ask",
    label: "请求批准",
    description: "编辑外部文件和使用互联网时始终询问",
    icon: Hand,
  },
  {
    value: "approve",
    label: "替我审批",
    description: "仅对检测到的风险操作请求批准",
    icon: Gauge,
  },
  {
    value: "full",
    label: "完全访问权限",
    description: "允许访问互联网和电脑上的文件",
    icon: ShieldCheck,
  },
];

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
  onPause,
  pausePending = false,
  onOpenSettings,
  rerunDraft = null,
  onPrepareRerun,
  onCancelRerun,
  previousRuns = [],
  selectedRunId = null,
  reportLoading = false,
  onSelectRun,
  model,
  modelOptions = [],
  onModelChange,
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
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const saved = window.localStorage.getItem("paperpilot.permissionMode");
    return saved === "ask" || saved === "full" ? saved : "approve";
  });
  const addMenu = useRef<HTMLDetailsElement>(null);
  const permissionMenu = useRef<HTMLDetailsElement>(null);
  const timelineEnd = useRef<HTMLDivElement>(null);
  const canCompose = !run || run.status === "completed";
  const canPause = Boolean(
    run && ["queued", "running", "waiting", "retrying"].includes(run.status),
  );
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
  useEffect(() => {
    window.localStorage.setItem("paperpilot.permissionMode", permissionMode);
  }, [permissionMode]);

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
            {canPause && onPause ? (
              <button
                className="pause-run-button"
                type="button"
                disabled={pausePending}
                title="停止整个研究任务"
                onClick={() => void onPause()}
              >
                <Square size={12} fill="currentColor" aria-hidden="true" />
                {pausePending ? "正在停止" : "暂停运行"}
              </button>
            ) : null}
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
          <div className="composer-input">
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
            <div className="composer-actions">
              <div className="composer-actions-left">
                <details
                  className="composer-menu"
                  ref={addMenu}
                  onToggle={(event) => {
                    if (event.currentTarget.open) permissionMenu.current?.removeAttribute("open");
                  }}
                >
                  <summary aria-label="添加">
                    <Plus size={18} aria-hidden="true" />
                  </summary>
                  <div className="composer-popover add-popover">
                    <strong>添加</strong>
                    <button type="button" disabled>
                      <Paperclip size={17} aria-hidden="true" />
                      <span>文件与 PDF<small>即将支持</small></span>
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
                  <summary aria-label={`权限：${permissionOptions.find((item) => item.value === permissionMode)!.label}`}>
                    <Gauge size={16} aria-hidden="true" />
                    {permissionOptions.find((item) => item.value === permissionMode)!.label}
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
                            setPermissionMode(option.value);
                            permissionMenu.current!.open = false;
                          }}
                        >
                          <PermissionIcon size={17} aria-hidden="true" />
                          <span>{option.label}<small>{option.description}</small></span>
                          {permissionMode === option.value ? <CheckCircle2 size={16} /> : null}
                        </button>
                      );
                    })}
                    <p>该偏好将用于后续插件；当前研究流程不会申请额外系统权限。</p>
                  </div>
                </details>
              </div>
              <div className="composer-actions-right">
                {model && modelOptions.length > 0 ? (
                  <label className="composer-model">
                    <span className="visually-hidden">模型</span>
                    <select
                      aria-label="当前使用的模型"
                      value={model}
                      disabled={pending}
                      onChange={(event) => void onModelChange?.(event.target.value)}
                    >
                      {modelOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  className="composer-send"
                  type="button"
                  onClick={() => void submit()}
                  disabled={!content.trim() || pending || !canCompose}
                  aria-label="发送"
                >
                  <Send size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
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
        ) : run?.status === "cancelled" ? (
          <div className="report-waiting report-stopped" role="status">
            <span><Square size={23} fill="currentColor" aria-hidden="true" /></span>
            <h2>研究运行已停止</h2>
            <p>整个研究任务已终止，未继续检索、证据抽取或生成报告。</p>
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
          ) : entry.value.status === "failed" || entry.value.status === "cancelled" ? (
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
                  : entry.value.status === "cancelled"
                    ? "已停止"
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
            const parsed = item.match(timelineItemPattern);
            const studies = splitTimelineStudies(parsed?.[2] ?? item);
            return (
              <li key={`${index}-${item}`}>
                <time>{parsed?.[1] ?? "阶段"}</time>
                <div className="timeline-studies">
                  {studies.map((study, studyIndex) => (
                    <p key={`${studyIndex}-${study}`}>
                      <EvidenceText text={study} evidence={report.evidence} onEvidence={onEvidence} />
                      {/[。！？!?；;]$/.test(study.trim()) ? null : "。"}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
        <ResearchDirectionMap
          title={report.title}
          timeline={report.timeline}
          evidence={report.evidence}
          onEvidence={onEvidence}
        />
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
        <div className="reference-table-wrap">
          <table className="reference-table">
            <thead>
              <tr><th>文献</th><th>期刊</th><th>ISSN</th><th>影响因子</th></tr>
            </thead>
            <tbody>
              {report.references.map((item, index) => {
                const record = report.evidence.find((evidence) => item.endsWith(`(${evidence.paperId})`));
                return (
                  <tr key={`${index}-${item}`}>
                    <td><span className="reference-index">{index + 1}.</span> <ReferenceText reference={item} evidence={report.evidence} /></td>
                    <td>{record?.journal ?? "未获取"}</td>
                    <td>{record?.issn ?? "—"}</td>
                    <td>
                      {record?.impactFactor != null ? (
                        record.impactFactorUrl ? (
                          <a
                            className="metric-link"
                            href={record.impactFactorUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`${record.impactFactorSource ?? "LetPub 参考值"} · ${record.impactFactorYear ?? "查询年份未知"}`}
                            onClick={(event) => {
                              event.preventDefault();
                              void openUrl(record.impactFactorUrl!);
                            }}
                          >
                            {record.impactFactor}
                          </a>
                        ) : record.impactFactor
                      ) : "未匹配"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="metric-note">影响因子来自 LetPub 公开查询页，仅作参考；点击蓝色数值可核验来源。</p>
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

export function buildResearchDirections(timeline: string[]): ResearchDirection[] {
  const grouped = new Map<string, DirectionStudy[]>();

  timeline.forEach((item) => {
    const parsed = item.match(timelineItemPattern);
    const year = parsed?.[1] ?? "阶段";
    splitTimelineStudies(parsed?.[2] ?? item).forEach((study) => {
      const searchable = study.replace(/[（(]?\s*evidence-\d+\s*[）)]?/gi, "");
      const ranked = researchDirectionRules
        .map((rule, index) => ({
          rule,
          index,
          score: rule.keywords.reduce(
            (score, keyword) => score + (searchable.includes(keyword) ? 1 : 0),
            0,
          ),
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index);
      const directionId = ranked[0].score > 0 ? ranked[0].rule.id : "general";
      grouped.set(directionId, [...(grouped.get(directionId) ?? []), { year, text: study }]);
    });
  });

  const directions: ResearchDirection[] = researchDirectionRules
    .filter((rule) => grouped.has(rule.id))
    .map((rule) => ({
      id: rule.id,
      label: rule.label,
      description: rule.description,
      studies: grouped.get(rule.id) ?? [],
    }));
  const generalStudies = grouped.get("general");
  if (generalStudies?.length) {
    directions.push({
      id: "general",
      label: "综合探索",
      description: "跨方向发现与综合性验证",
      studies: generalStudies,
    });
  }
  return directions;
}

function graphEvidenceRecords(text: string, evidence: EvidenceRecord[]): EvidenceRecord[] {
  const tokens = Array.from(text.matchAll(/\bevidence-\d+\b/gi), (match) =>
    match[0].toLowerCase(),
  );
  return evidence.filter((record) => {
    const id = record.id.toLowerCase();
    return tokens.some((token) => id === token || id.endsWith(`-${token}`));
  });
}

function graphStudyLabel(text: string): string {
  return text
    .replace(/[（(]?\s*evidence-\d+\s*[）)]?/gi, "")
    .replace(/[。！？!?；;]+$/, "")
    .trim();
}

function graphLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function buildKnowledgeGraphLayout(
  directions: ResearchDirection[],
  evidence: EvidenceRecord[],
): KnowledgeGraphLayout {
  const directionNodes: KnowledgeGraphDirectionNode[] = directions.map((direction, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / directions.length;
    return {
      ...direction,
      x: knowledgeGraphCenter + Math.cos(angle) * 200,
      y: knowledgeGraphCenter + Math.sin(angle) * 200,
      color: knowledgeGraphColors[direction.id] ?? knowledgeGraphColors.general,
    };
  });

  const papers = new Map<
    string,
    Omit<KnowledgeGraphPaperNode, "x" | "y" | "radius" | "isCore">
  >();
  directions.forEach((direction) => {
    direction.studies.forEach((study, studyIndex) => {
      const records = graphEvidenceRecords(study.text, evidence);
      const candidates = records.length > 0
        ? records.map((record) => ({
            id: record.id,
            title: record.paperTitle,
            evidenceIds: [record.id],
            authors: record.authors,
            genes: record.genes,
            findings: record.findings,
            score: record.confidence + record.supports.length * 0.45,
          }))
        : [{
            id: `${direction.id}-${study.year}-${studyIndex}-${graphStudyLabel(study.text)}`,
            title: graphStudyLabel(study.text),
            evidenceIds: [] as string[],
            authors: [] as string[],
            genes: [] as string[],
            findings: [] as string[],
            score: 0,
          }];

      candidates.forEach((candidate) => {
        const existing = papers.get(candidate.id);
        if (existing) {
          if (!existing.directionIds.includes(direction.id)) {
            existing.directionIds.push(direction.id);
          }
          existing.score = Math.max(existing.score, candidate.score);
          existing.authors = Array.from(new Set([...existing.authors, ...candidate.authors]));
          existing.genes = Array.from(new Set([...existing.genes, ...candidate.genes]));
          existing.findings = Array.from(new Set([...existing.findings, ...candidate.findings]));
          return;
        }
        papers.set(candidate.id, {
          id: candidate.id,
          title: candidate.title,
          summary: graphStudyLabel(study.text),
          year: study.year,
          directionIds: [direction.id],
          evidenceIds: candidate.evidenceIds,
          authors: candidate.authors,
          genes: candidate.genes,
          findings: candidate.findings,
          score: candidate.score,
        });
      });
    });
  });

  const positionedPapers: KnowledgeGraphPaperNode[] = [];
  directionNodes.forEach((direction, directionIndex) => {
    const primaryPapers = Array.from(papers.values()).filter(
      (paper) => paper.directionIds[0] === direction.id,
    );
    const directionAngle = -Math.PI / 2 + (directionIndex * Math.PI * 2) / directions.length;
    const sectorSpan = Math.min(1.15, ((Math.PI * 2) / directions.length) * 0.76);
    const papersPerRing = 12;
    primaryPapers.forEach((paper, paperIndex) => {
      const ring = Math.floor(paperIndex / papersPerRing);
      const ringStart = ring * papersPerRing;
      const ringCount = Math.min(papersPerRing, primaryPapers.length - ringStart);
      const ringIndex = paperIndex - ringStart;
      const offset = ringCount === 1
        ? 0
        : -sectorSpan / 2 + (ringIndex * sectorSpan) / (ringCount - 1);
      const radius = 330 + ring * 42;
      positionedPapers.push({
        ...paper,
        x: knowledgeGraphCenter + Math.cos(directionAngle + offset) * radius,
        y: knowledgeGraphCenter + Math.sin(directionAngle + offset) * radius,
        radius: 5,
        isCore: false,
      });
    });
  });

  const coreCount = Math.min(6, Math.max(1, Math.ceil(positionedPapers.length * 0.08)));
  const coreIds = new Set(
    [...positionedPapers]
      .sort((left, right) =>
        right.directionIds.length - left.directionIds.length
        || right.score - left.score
        || left.year.localeCompare(right.year))
      .slice(0, coreCount)
      .map((paper) => paper.id),
  );
  positionedPapers.forEach((paper) => {
    paper.isCore = coreIds.has(paper.id);
    paper.radius = 5 + Math.min(4, paper.score * 0.9) + (paper.isCore ? 2 : 0);
  });

  const paperById = new Map(positionedPapers.map((paper) => [paper.id, paper]));
  const entityCandidates = new Map<
    string,
    Omit<KnowledgeGraphEntityNode, "x" | "y" | "radius">
  >();
  const registerEntities = (
    paper: KnowledgeGraphPaperNode,
    kind: KnowledgeGraphEntityKind,
    values: string[],
  ) => {
    values.forEach((value) => {
      const label = value.trim();
      if (!label) return;
      const id = `${kind}:${label.toLowerCase()}`;
      const existing = entityCandidates.get(id);
      if (existing) {
        if (!existing.paperIds.includes(paper.id)) existing.paperIds.push(paper.id);
        return;
      }
      entityCandidates.set(id, { id, kind, label, paperIds: [paper.id] });
    });
  };
  positionedPapers.forEach((paper) => {
    registerEntities(paper, "author", paper.authors);
    registerEntities(paper, "gene", paper.genes);
    registerEntities(paper, "finding", paper.findings);
  });
  const selectedEntities = (["gene", "author", "finding"] as const).flatMap((kind) =>
    Array.from(entityCandidates.values())
      .filter((entity) => entity.kind === kind)
      .sort((left, right) =>
        right.paperIds.length - left.paperIds.length || left.label.localeCompare(right.label))
      .slice(0, 40),
  );
  const entities: KnowledgeGraphEntityNode[] = [];
  directionNodes.forEach((direction, directionIndex) => {
    const directionEntities = selectedEntities
      .filter((entity) => {
        const firstPaper = paperById.get(entity.paperIds[0]);
        return firstPaper?.directionIds[0] === direction.id;
      })
      .slice(0, 48);
    const directionAngle = -Math.PI / 2 + (directionIndex * Math.PI * 2) / directions.length;
    const sectorSpan = Math.min(1.18, ((Math.PI * 2) / directions.length) * 0.82);
    const entitiesPerRing = 16;
    directionEntities.forEach((entity, entityIndex) => {
      const ring = Math.floor(entityIndex / entitiesPerRing);
      const ringStart = ring * entitiesPerRing;
      const ringCount = Math.min(entitiesPerRing, directionEntities.length - ringStart);
      const ringIndex = entityIndex - ringStart;
      const offset = ringCount === 1
        ? 0
        : -sectorSpan / 2 + (ringIndex * sectorSpan) / (ringCount - 1);
      const radius = 500 + ring * 34;
      entities.push({
        ...entity,
        x: knowledgeGraphCenter + Math.cos(directionAngle + offset) * radius,
        y: knowledgeGraphCenter + Math.sin(directionAngle + offset) * radius,
        radius: entity.kind === "gene" ? 8 : entity.kind === "author" ? 6 : 5,
      });
    });
  });
  const edges: KnowledgeGraphEdge[] = directionNodes.map((direction) => ({
    id: `theme-${direction.id}`,
    kind: "theme",
    sourceX: knowledgeGraphCenter,
    sourceY: knowledgeGraphCenter,
    targetX: direction.x,
    targetY: direction.y,
  }));

  directionNodes.forEach((direction) => {
    const associatedPapers = positionedPapers
      .filter((paper) => paper.directionIds.includes(direction.id))
      .sort((left, right) => left.year.localeCompare(right.year));
    associatedPapers.forEach((paper) => {
      edges.push({
        id: `association-${direction.id}-${paper.id}`,
        kind: "association",
        sourceX: direction.x,
        sourceY: direction.y,
        targetX: paper.x,
        targetY: paper.y,
      });
    });
    associatedPapers.slice(1).forEach((paper, index) => {
      const previous = paperById.get(associatedPapers[index].id);
      if (!previous) return;
      edges.push({
        id: `progression-${direction.id}-${previous.id}-${paper.id}`,
        kind: "progression",
        sourceX: previous.x,
        sourceY: previous.y,
        targetX: paper.x,
        targetY: paper.y,
      });
    });
  });

  entities.forEach((entity) => {
    entity.paperIds.forEach((paperId) => {
      const paper = paperById.get(paperId);
      if (!paper) return;
      edges.push({
        id: `${entity.kind}-${paper.id}-${entity.id}`,
        kind: entity.kind,
        sourceX: paper.x,
        sourceY: paper.y,
        targetX: entity.x,
        targetY: entity.y,
      });
    });
  });

  return { directions: directionNodes, papers: positionedPapers, entities, edges };
}

function ResearchDirectionMap({
  title,
  timeline,
  evidence,
  onEvidence,
}: {
  title: string;
  timeline: string[];
  evidence: EvidenceRecord[];
  onEvidence: (ids: string[]) => void;
}) {
  const directions = useMemo(() => buildResearchDirections(timeline), [timeline]);
  const graph = useMemo(
    () => buildKnowledgeGraphLayout(directions, evidence),
    [directions, evidence],
  );
  const [activeGraphNode, setActiveGraphNode] = useState<{
    kind: "paper" | "entity";
    id: string;
  } | null>(null);
  if (directions.length === 0) return null;
  const defaultPaper = graph.papers.find((paper) => paper.isCore) ?? graph.papers[0];
  const activePaper = activeGraphNode?.kind === "paper"
    ? graph.papers.find((paper) => paper.id === activeGraphNode.id)
    : activeGraphNode
      ? undefined
      : defaultPaper;
  const activeEntity = activeGraphNode?.kind === "entity"
    ? graph.entities.find((entity) => entity.id === activeGraphNode.id)
    : undefined;
  const directionById = new Map(graph.directions.map((direction) => [direction.id, direction]));
  const centerTitle = graphLabel(title, 14);
  const centerTitleLines = [centerTitle.slice(0, 7), centerTitle.slice(7)].filter(Boolean);

  function activatePaper(paper: KnowledgeGraphPaperNode) {
    setActiveGraphNode({ kind: "paper", id: paper.id });
    if (paper.evidenceIds.length > 0) onEvidence(paper.evidenceIds);
  }

  return (
    <section className="research-direction-map" aria-labelledby="research-direction-title">
      <header>
        <span><GitBranch size={17} aria-hidden="true" /></span>
        <div>
          <h3 id="research-direction-title">研究知识图谱</h3>
          <p>连接研究方向、论文、作者、基因与关键结果，发现核心文献和实体聚类。</p>
        </div>
      </header>
      <div
        aria-label="研究知识图谱，纵向滚动"
        className="knowledge-graph-scroll"
        role="region"
        tabIndex={0}
      >
        <div className="knowledge-graph">
          <div className="knowledge-graph-legend" aria-label="图谱图例">
            <span><i className="legend-topic" />中心主题</span>
            <span><i className="legend-direction" />研究方向</span>
            <span><i className="legend-paper" />论文</span>
            <span><i className="legend-author" />作者</span>
            <span><i className="legend-gene" />基因/蛋白</span>
            <span><i className="legend-finding" />研究结果</span>
            <span><i className="legend-core" />核心文献</span>
            <span><i className="legend-edge" />主题关联</span>
            <span><i className="legend-progression" />同方向演进</span>
          </div>
          <svg
            aria-label={`${title}的研究知识图谱，共${graph.directions.length}个方向、${graph.papers.length}篇论文、${graph.entities.length}个结构化实体`}
            data-testid="research-knowledge-graph"
            role="group"
            viewBox={`0 0 ${knowledgeGraphSize} ${knowledgeGraphSize}`}
          >
            <g className="knowledge-graph-edges" aria-hidden="true">
              {graph.edges.map((edge) => (
                <line
                  className={`knowledge-edge knowledge-edge-${edge.kind}`}
                  key={edge.id}
                  x1={edge.sourceX}
                  x2={edge.targetX}
                  y1={edge.sourceY}
                  y2={edge.targetY}
                />
              ))}
            </g>
            <g className="knowledge-center-node" aria-label={`中心主题：${title}`}>
              <circle cx={knowledgeGraphCenter} cy={knowledgeGraphCenter} r="78" />
              <text x={knowledgeGraphCenter} y={knowledgeGraphCenter - 31}>
                <tspan x={knowledgeGraphCenter}>研究主题</tspan>
                {centerTitleLines.map((line) => (
                  <tspan
                    className="knowledge-center-title"
                    dy="20"
                    key={line}
                    x={knowledgeGraphCenter}
                  >
                    {line}
                  </tspan>
                ))}
                <tspan dy="19" x={knowledgeGraphCenter}>
                  {graph.papers.length} 篇论文 · {graph.entities.length} 个实体
                </tspan>
              </text>
            </g>
            {graph.directions.map((direction) => (
              <g
                aria-label={`研究方向：${direction.label}，${direction.studies.length}项`}
                className="knowledge-direction-node"
                data-testid="knowledge-direction-node"
                key={direction.id}
              >
                <circle
                  cx={direction.x}
                  cy={direction.y}
                  fill={direction.color}
                  r="49"
                />
                <text x={direction.x} y={direction.y - 4}>
                  <tspan x={direction.x}>{direction.label}</tspan>
                  <tspan dy="18" x={direction.x}>{direction.studies.length} 项</tspan>
                </text>
              </g>
            ))}
            {graph.papers.map((paper) => {
              const direction = directionById.get(paper.directionIds[0]);
              return (
                <g
                  aria-label={`${paper.isCore ? "核心文献，" : ""}${paper.year}，${paper.title}`}
                  className={`knowledge-paper-node${paper.isCore ? " is-core" : ""}${paper.evidenceIds.length > 0 ? " has-evidence" : ""}`}
                  data-testid="knowledge-paper-node"
                  key={paper.id}
                  onClick={() => activatePaper(paper)}
                  onFocus={() => setActiveGraphNode({ kind: "paper", id: paper.id })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    activatePaper(paper);
                  }}
                  onMouseEnter={() => setActiveGraphNode({ kind: "paper", id: paper.id })}
                  role="button"
                  tabIndex={0}
                >
                  <title>{`${paper.year} · ${paper.title}`}</title>
                  {paper.isCore ? (
                    <circle
                      className="knowledge-core-ring"
                      cx={paper.x}
                      cy={paper.y}
                      r={paper.radius + 5}
                    />
                  ) : null}
                  <circle
                    cx={paper.x}
                    cy={paper.y}
                    fill={direction?.color ?? knowledgeGraphColors.general}
                    r={paper.radius}
                  />
                  {paper.isCore ? (
                    <text x={paper.x} y={paper.y + paper.radius + 15}>{paper.year}</text>
                  ) : null}
                </g>
              );
            })}
            {graph.entities.map((entity) => {
              const kindLabel = entity.kind === "author"
                ? "作者"
                : entity.kind === "gene"
                  ? "基因或蛋白"
                  : "研究结果";
              return (
                <g
                  aria-label={`${kindLabel}：${entity.label}，关联${entity.paperIds.length}篇论文`}
                  className={`knowledge-entity-node knowledge-entity-${entity.kind}`}
                  data-testid="knowledge-entity-node"
                  key={entity.id}
                  onClick={() => setActiveGraphNode({ kind: "entity", id: entity.id })}
                  onFocus={() => setActiveGraphNode({ kind: "entity", id: entity.id })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setActiveGraphNode({ kind: "entity", id: entity.id });
                  }}
                  onMouseEnter={() => setActiveGraphNode({ kind: "entity", id: entity.id })}
                  role="button"
                  tabIndex={0}
                >
                  <title>{`${kindLabel} · ${entity.label} · ${entity.paperIds.length}篇论文`}</title>
                  <circle cx={entity.x} cy={entity.y} r={entity.radius} />
                  {entity.kind === "gene" || entity.paperIds.length > 1 ? (
                    <text x={entity.x} y={entity.y + entity.radius + 13}>
                      {graphLabel(entity.label, 11)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {activePaper ? (
        <div className="knowledge-graph-detail" aria-live="polite">
          <div>
            <span>{activePaper.isCore ? "核心文献" : "论文节点"} · {activePaper.year}</span>
            <strong>{activePaper.title}</strong>
          </div>
          <p>{activePaper.summary}</p>
          <small>
            {activePaper.directionIds
              .map((id) => directionById.get(id)?.label)
              .filter(Boolean)
              .join(" · ")}
            {activePaper.evidenceIds.length > 0 ? " · 点击节点查看证据" : " · 暂无可展开证据"}
          </small>
        </div>
      ) : null}
      {activeEntity ? (
        <div className="knowledge-graph-detail" aria-live="polite">
          <div>
            <span>
              {activeEntity.kind === "author"
                ? "作者节点"
                : activeEntity.kind === "gene"
                  ? "基因/蛋白节点"
                  : "研究结果节点"}
            </span>
            <strong>{activeEntity.label}</strong>
          </div>
          <p>
            关联 {activeEntity.paperIds.length} 篇论文：
            {activeEntity.paperIds
              .map((id) => graph.papers.find((paper) => paper.id === id)?.title)
              .filter(Boolean)
              .slice(0, 3)
              .join("；")}
          </p>
          <small>共享实体只显示一个节点，并连接所有包含它的论文。</small>
        </div>
      ) : null}
      <p className="direction-map-note">作者来自文献数据库元数据；基因/蛋白与研究结果来自当前摘要的结构化证据抽取。引用关系需可靠引用数据后再展示，不从文本中猜测。</p>
    </section>
  );
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
  return text
    .split(/([（(]\s*evidence-\d+\s*[）)]|\bevidence-\d+\b)/gi)
    .map((part, index) => {
      const token = part.match(/\bevidence-\d+\b/i)?.[0];
      if (!token) return <span key={`${index}-${part}`}>{part}</span>;
      const record = evidence.find((item) => {
        const id = item.id.toLowerCase();
        const normalizedToken = token.toLowerCase();
        return id === normalizedToken || id.endsWith(`-${normalizedToken}`);
      });
      if (!record) return <span key={`${index}-${part}`}>{part}</span>;
      const citationNumber = token.slice(token.lastIndexOf("-") + 1);
      return (
        <sup className="inline-evidence-citation" key={`${index}-${part}`}>
          <button
            aria-label={`打开证据 ${token}`}
            className="inline-evidence-link"
            type="button"
            onClick={() => onEvidence([record.id])}
          >
            [{citationNumber}]
          </button>
        </sup>
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
      <dl><div><dt>定位</dt><dd>{evidence.locator}</dd></div><div><dt>论文标识</dt><dd><PaperIdentifier paperId={evidence.paperId} /></dd></div><div><dt>作者</dt><dd>{evidence.authors.join("、") || "未获取"}</dd></div><div><dt>基因/蛋白</dt><dd className="evidence-entity-list">{evidence.genes.length > 0 ? evidence.genes.map((gene) => <span key={gene}>{gene}</span>) : "未提取"}</dd></div><div><dt>关键结果</dt><dd>{evidence.findings.length > 0 ? <ul>{evidence.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul> : "未提取"}</dd></div><div><dt>期刊</dt><dd>{evidence.journal ?? "未获取"}{evidence.issn ? `（${evidence.issn}）` : ""}</dd></div><div><dt>影响因子</dt><dd>{evidence.impactFactor ?? "未匹配"}{evidence.impactFactorSource ? ` · ${evidence.impactFactorSource}` : ""}</dd></div><div><dt>证据类型</dt><dd>{evidence.evidenceType}</dd></div><div><dt>置信度</dt><dd>{Math.round(evidence.confidence * 100)}%</dd></div></dl>
    </aside>
  );
}
