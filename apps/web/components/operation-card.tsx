import {
  BookOpenCheck,
  Check,
  CircleAlert,
  FileCheck2,
  FileSearch,
  FlaskConical,
  LoaderCircle,
  RefreshCcw,
  Save,
  ScanSearch,
  Sparkles,
} from "lucide-react";

import type { RunOperation, RunOperationKind } from "../lib/api";

interface OperationCardProps {
  operation: RunOperation;
  onRetry?: () => void;
}
const operationIcons: Partial<Record<RunOperationKind, typeof ScanSearch>> = {
  search_source: ScanSearch,
  screen: FileSearch,
  parse: BookOpenCheck,
  create_evidence: FlaskConical,
  synthesize: Sparkles,
  recommend: Sparkles,
  citation_audit: FileCheck2,
  save_report: Save,
  lookup_evidence: FileSearch,
  grounded_response: Sparkles,
  save_response: Save,
  revise_report: Sparkles,
  revision_validation: FileCheck2,
  save_revision: Save,
};

const statusLabels = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
} as const;

const metricLabels: Record<string, (value: number) => string> = {
  source_count: (value) => `${value} 个文献来源`,
  candidate_count: (value) => `${value} 篇候选文献`,
  retained_count: (value) => `${value} 篇保留文献`,
  parsed_count: (value) => `${value} 篇已解析`,
  evidence_count: (value) => `${value} 条证据`,
  recommendation_count: (value) => `${value} 个研究方案`,
  citation_count: (value) => `${value} 个引用`,
  report_version: (value) => `报告版本 ${value}`,
  duration_ms: (value) => `${formatDuration(value)} 秒`,
};

export function OperationCard({ operation, onRetry }: OperationCardProps) {
  const Icon = operationIcons[operation.operation_kind] ?? FlaskConical;
  const retryable = operation.task_kind === "research_run"
    && operation.status === "failed"
    && Boolean(onRetry);

  return (
    <article
      className={`operation-card operation-${operation.status}`}
      aria-label={`研究操作：${operation.title}`}
    >
      <div className="operation-icon" aria-hidden="true">
        {operation.status === "running" ? <LoaderCircle size={16} /> : <Icon size={16} />}
      </div>
      <div className="operation-body">
        <header>
          <strong>{operation.title}</strong>
          <span className="operation-status">
            {operation.status === "completed" ? <Check size={13} /> : null}
            {operation.status === "failed" ? <CircleAlert size={13} /> : null}
            {statusLabels[operation.status]}
          </span>
        </header>
        <p>{operation.summary}</p>
        <div className="operation-meta">
          {Object.entries(operation.metrics).map(([key, value]) => {
            const format = metricLabels[key];
            return format ? <span key={key}>{format(value)}</span> : null;
          })}
          <time dateTime={operation.completed_at ?? operation.started_at}>
            {new Date(operation.completed_at ?? operation.started_at).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        {retryable ? (
          <button type="button" className="operation-retry" onClick={onRetry}>
            <RefreshCcw size={14} aria-hidden="true" />
            重试研究任务
          </button>
        ) : null}
      </div>
    </article>
  );
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
}
