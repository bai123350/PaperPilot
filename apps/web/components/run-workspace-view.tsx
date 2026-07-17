import { AlertTriangle, CheckCircle2, Clock3, RotateCcw } from "lucide-react";

import type { RunRecord } from "../lib/api";
import { getStageProgress, type StageKey } from "../lib/stages";
import type { ReportViewModel } from "../lib/types";
import { ReportView } from "./report-view";
import { StageRail } from "./stage-rail";

export function RunWorkspaceView({ run, report }: { run: RunRecord; report: ReportViewModel | null }) {
  const progress = getStageProgress(run.status, run.stage as StageKey | null);
  const complete = run.status === "completed";
  const failed = run.status === "failed";

  return (
    <div className="run-workspace">
      <header className="run-header">
        <div>
          <span className={`status-pill status-${run.status}`}>
            {complete ? <CheckCircle2 size={15} /> : failed ? <AlertTriangle size={15} /> : <Clock3 size={15} />}
            {complete ? "研究完成" : failed ? "运行失败" : "研究进行中"}
          </span>
          <h1>{complete ? "研究报告" : "正在构建证据图谱"}</h1>
        </div>
        <div className="run-progress-number">{progress}%</div>
      </header>

      <div className="progress-track" aria-label={`研究进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      {!complete ? (
        <div className="run-grid">
          <section className="run-stage-panel">
            <div className="section-heading compact">
              <div><span className="section-number">RUN</span><h2>研究流水线</h2></div>
            </div>
            <StageRail currentStage={run.stage as StageKey | null} status={run.status} />
          </section>
          <aside className="run-facts">
            <h2>运行信息</h2>
            <dl>
              <div><dt>运行编号</dt><dd>{run.id.slice(0, 12)}</dd></div>
              <div><dt>创建时间</dt><dd>{new Date(run.created_at).toLocaleString("zh-CN")}</dd></div>
              <div><dt>当前阶段</dt><dd>{run.stage ?? "等待中"}</dd></div>
            </dl>
            {failed ? (
              <div className="run-error"><RotateCcw size={18} /><span>{run.error ?? "任务未完成"}</span></div>
            ) : null}
          </aside>
        </div>
      ) : report ? <ReportView report={report} /> : null}
    </div>
  );
}
