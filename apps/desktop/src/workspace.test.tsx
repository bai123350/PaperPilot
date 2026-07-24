import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Report } from "./generated/contracts";
import { Workspace } from "./workspace";

const report: Report = {
  contractVersion: "1.0",
  schemaVersion: "1.0",
  runId: "run-1",
  version: 1,
  title: "PD-1 耐药标志物：证据图谱与下一步",
  summary: "多源证据提示三条主要耐药路径。",
  timeline: [],
  themes: ["抗原呈递"],
  claims: [
    {
      id: "claim-1",
      statement: "抗原呈递缺陷与原发耐药稳定相关。",
      evidenceIds: ["evidence-1"],
    },
  ],
  controversies: [],
  limitations: [],
  gaps: [],
  recommendations: [1, 2, 3].map((index) => ({
    id: `recommendation-${index}`,
    title: `研究方案 ${index}`,
    rationale: "依据",
    hypothesis: "可检验假设",
    minimalValidation: "最小验证",
    resources: ["现有队列"],
    risks: ["偏倚"],
    stopCondition: "数据不足",
    evidenceIds: ["evidence-1"],
  })),
  evidence: [
    {
      id: "evidence-1",
      runId: "run-1",
      paperId: "pmid:1",
      paperTitle: "Evidence paper",
      excerpt: "可追溯的原文证据片段。",
      locator: "page 2",
      evidenceType: "observational",
      confidence: 0.9,
      supports: ["claim-1"],
    },
  ],
  references: [],
  disclaimer: "本报告仅供科研用途。",
  createdAt: "2026-07-24T00:00:00Z",
};

describe("desktop workspace", () => {
  it("keeps the report pane waiting while operations stream on the left", () => {
    render(
      <Workspace
        projectName="免疫耐药"
        run={{
          id: "run-1",
          projectId: "project-1",
          status: "running",
          stage: "create_evidence",
          progress: 58,
          reportVersion: 0,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:01:00Z",
          completedAt: null,
        }}
        messages={[]}
        operations={[
          {
            id: "operation-1",
            runId: "run-1",
            sequence: 1,
            operationKind: "search_sources",
            stage: "search_sources",
            title: "多源检索",
            summary: "已检索固定演示文献。",
            status: "completed",
            createdAt: "2026-07-24T00:00:00Z",
          },
        ]}
        report={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "研究对话" })).toBeInTheDocument();
    expect(screen.getByText("多源检索")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "报告生成中" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace")).toHaveClass("desktop-workspace");
  });

  it("shows the complete report, exactly three plans, and traceable evidence", () => {
    render(
      <Workspace
        projectName="免疫耐药"
        run={{
          id: "run-1",
          projectId: "project-1",
          status: "completed",
          stage: "citation_audit",
          progress: 100,
          reportVersion: 1,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:01:00Z",
          completedAt: "2026-07-24T00:01:00Z",
        }}
        messages={[]}
        operations={[]}
        report={report}
      />,
    );

    expect(screen.getByRole("heading", { name: report.title })).toBeInTheDocument();
    expect(screen.getAllByTestId("recommendation-card")).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "查看 1 条证据" })[0]);
    expect(screen.getByText("可追溯的原文证据片段。")).toBeInTheDocument();
    expect(screen.getByText("page 2")).toBeInTheDocument();
  });
});
