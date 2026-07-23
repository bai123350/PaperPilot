import { CircleAlert, FileClock } from "lucide-react";

import type { RunRecord } from "../lib/api";
import type { ReportViewModel } from "../lib/types";
import { ReportView } from "./report-view";

export function RunWorkspaceView({ run, report }: { run: RunRecord; report: ReportViewModel | null }) {
  if (run.status === "completed" && report) {
    return (
      <div className="run-workspace run-workspace-report">
        <ReportView report={report} />
      </div>
    );
  }

  if (run.status === "failed" || run.status === "cancelled") {
    return (
      <div className="run-workspace run-report-state run-report-terminal">
        <CircleAlert size={28} aria-hidden="true" />
        <h1>尚未生成报告</h1>
        <p>可在左侧查看失败操作并重试，已有对话与操作记录不会丢失。</p>
      </div>
    );
  }

  return (
    <div className="run-workspace run-report-state" aria-live="polite">
      <span className="report-waiting-icon" aria-hidden="true">
        <FileClock size={25} />
      </span>
      <h1>报告准备中</h1>
      <p>PaperPilot 正在检索、核对并组织证据，完成后将在这里呈现最终报告。</p>
    </div>
  );
}
