import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
            summary: "已检索真实文献来源。",
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
    expect(screen.getByLabelText("继续研究对话")).toBeDisabled();
    expect(screen.getByTestId("workspace")).toHaveClass("desktop-workspace");
  });

  it("shows the complete report, exactly three plans, and traceable evidence", () => {
    const onExport = vi.fn();
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
        onExport={onExport}
      />,
    );

    expect(screen.getByRole("heading", { name: report.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "进展时间线" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "主题版图" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "参考文献" })).toBeInTheDocument();
    expect(screen.getAllByTestId("recommendation-card")).toHaveLength(3);
    expect(screen.getByLabelText("继续研究对话")).toBeEnabled();
    fireEvent.click(screen.getAllByRole("button", { name: "查看 1 条证据" })[0]);
    expect(screen.getByText("可追溯的原文证据片段。")).toBeInTheDocument();
    expect(screen.getByText("page 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(onExport).toHaveBeenCalledWith("markdown");
  });

  it("shows an honest failure state without rendering an invented report", () => {
    const onRetry = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <Workspace
        projectName="失败研究"
        run={{
          id: "run-failed",
          projectId: "project-1",
          status: "failed",
          stage: "synthesize",
          progress: 66,
          reportVersion: 0,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:01:00Z",
          completedAt: null,
        }}
        messages={[]}
        operations={[]}
        report={null}
        failureReason="研究运行失败：模型返回的证据抽取格式无效。"
        onRetry={onRetry}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByRole("heading", { name: "研究运行失败" })).toBeInTheDocument();
    expect(screen.getByText(/证据抽取格式无效/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "报告生成中" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("继续研究对话")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
    fireEvent.click(screen.getByRole("button", { name: "重新运行" }));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalled();
  });

  it("passes optional research parameters as a structured brief", () => {
    const onStart = vi.fn();
    render(
      <Workspace
        projectName="免疫耐药"
        run={null}
        messages={[]}
        operations={[]}
        report={null}
        onStart={onStart}
      />,
    );

    fireEvent.change(screen.getByLabelText("人群（P）"), { target: { value: "晚期 NSCLC" } });
    fireEvent.change(screen.getByLabelText("结局（O）"), { target: { value: "OS，PFS" } });
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "PD-1, resistance" } });
    fireEvent.change(screen.getByLabelText("起始年份"), { target: { value: "2020" } });
    fireEvent.change(screen.getByLabelText("结束年份"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("输入研究问题"), { target: { value: "哪些标志物相关？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "哪些标志物相关？",
        population: "晚期 NSCLC",
        outcomes: ["OS", "PFS"],
        keywords: ["PD-1", "resistance"],
        dateFrom: 2020,
        dateTo: 2026,
      }),
    );
  });

  it("rejects an inverted research date range before starting", () => {
    const onStart = vi.fn();
    render(
      <Workspace
        projectName="免疫耐药"
        run={null}
        messages={[]}
        operations={[]}
        report={null}
        onStart={onStart}
      />,
    );

    fireEvent.change(screen.getByLabelText("起始年份"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("结束年份"), { target: { value: "2020" } });
    fireEvent.change(screen.getByLabelText("输入研究问题"), { target: { value: "哪些标志物相关？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("alert")).toHaveTextContent("起始年份不能晚于结束年份");
    expect(onStart).not.toHaveBeenCalled();
  });
});
