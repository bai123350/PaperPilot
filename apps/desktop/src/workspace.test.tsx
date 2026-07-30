import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { describe, expect, it, vi } from "vitest";

import type { Report, RunSnapshot } from "./generated/contracts";
import { Workspace, paperIdentifierUrl, splitTimelineStudies } from "./workspace";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const report: Report = {
  contractVersion: "1.0",
  schemaVersion: "1.0",
  runId: "run-1",
  version: 1,
  title: "PD-1 耐药标志物：证据图谱与下一步",
  summary: "多源证据提示三条主要耐药路径。",
  timeline: ["2010：早期文献建立了机制假设。", "2026：最新研究完成多模态验证。"],
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
      journal: null,
      issn: null,
      impactFactor: null,
      impactFactorYear: null,
      impactFactorSource: null,
      impactFactorUrl: null,
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

describe("splitTimelineStudies", () => {
  it("puts semicolon- and newline-separated papers on individual lines", () => {
    expect(
      splitTimelineStudies(
        "研究甲取得进展（evidence-1）；研究乙完成验证（evidence-2）\n研究丙补充机制（evidence-3）。",
      ),
    ).toEqual([
      "研究甲取得进展（evidence-1）",
      "研究乙完成验证（evidence-2）",
      "研究丙补充机制（evidence-3）。",
    ]);
  });
});

describe("paperIdentifierUrl", () => {
  it("links supported literature identifiers to authoritative pages", () => {
    expect(paperIdentifierUrl("pmid:42004959")).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/42004959/",
    );
    expect(paperIdentifierUrl("doi:10.1000/example")).toBe(
      "https://doi.org/10.1000/example",
    );
  });
});

describe("run controls", () => {
  it("shows a pause control beside active progress and invokes the stop handler", () => {
    const onPause = vi.fn();
    render(
      <Workspace
        projectName="哮喘"
        run={{
          id: "run-active",
          projectId: "project-1",
          status: "running",
          stage: "screen",
          progress: 33,
          reportVersion: 0,
          createdAt: "2026-07-30T00:00:00Z",
          updatedAt: "2026-07-30T00:01:00Z",
          completedAt: null,
        }}
        messages={[]}
        operations={[]}
        report={null}
        onPause={onPause}
      />,
    );

    const progress = screen.getByText("运行 33%");
    const pause = screen.getByRole("button", { name: "暂停运行" });
    expect(progress.parentElement).toContainElement(pause);
    expect(progress.nextElementSibling).toBe(pause);
    fireEvent.click(pause);
    expect(onPause).toHaveBeenCalledOnce();
  });

  it("shows a terminal stopped state after cancellation", () => {
    render(
      <Workspace
        projectName="哮喘"
        run={{
          id: "run-cancelled",
          projectId: "project-1",
          status: "cancelled",
          stage: "screen",
          progress: 33,
          reportVersion: 0,
          createdAt: "2026-07-30T00:00:00Z",
          updatedAt: "2026-07-30T00:01:00Z",
          completedAt: null,
        }}
        messages={[]}
        operations={[]}
        report={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "研究运行已停止" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "暂停运行" })).not.toBeInTheDocument();
  });
});

const previousRun: RunSnapshot = {
  contractVersion: "1.0",
  run: {
    id: "run-history",
    projectId: "project-1",
    status: "completed",
    stage: "citation_audit",
    progress: 100,
    reportVersion: 1,
    createdAt: "2026-07-23T00:00:00Z",
    updatedAt: "2026-07-23T00:01:00Z",
    completedAt: "2026-07-23T00:01:00Z",
  },
  brief: {
    question: "旧问题：哪些耐药标志物值得关注？",
    population: null,
    intervention: null,
    comparison: null,
    outcomes: [],
    keywords: [],
    dateFrom: 2020,
    dateTo: 2025,
    studyTypes: [],
  },
  messages: [
    {
      id: "message-history-user",
      runId: "run-history",
      sequence: 1,
      role: "user",
      content: "旧问题：哪些耐药标志物值得关注？",
      evidenceIds: [],
      reportVersion: null,
      createdAt: "2026-07-23T00:00:00Z",
    },
    {
      id: "message-history-assistant",
      runId: "run-history",
      sequence: 20,
      role: "assistant",
      content: "已依据检索证据生成报告：旧报告摘要不应再次占满对话框。",
      evidenceIds: [],
      reportVersion: 1,
      createdAt: "2026-07-23T00:01:00Z",
    },
  ],
  operations: [
    {
      id: "operation-history",
      runId: "run-history",
      sequence: 2,
      operationKind: "search_sources",
      stage: "search_sources",
      title: "旧运行多源检索",
      summary: "旧运行检索轨迹。",
      status: "completed",
      createdAt: "2026-07-23T00:00:10Z",
    },
  ],
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
            summary:
              "已检索真实文献来源。\nGoogle Scholar：https://scholar.google.com/scholar?q=single%20cell",
            status: "completed",
            createdAt: "2026-07-24T00:00:00Z",
          },
        ]}
        report={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "研究对话" })).toBeInTheDocument();
    expect(screen.getByText("多源检索")).toBeInTheDocument();
    const scholarLink = screen.getByRole("link", { name: "打开 Google Scholar" });
    expect(scholarLink).toHaveAttribute(
      "href",
      "https://scholar.google.com/scholar?q=single%20cell",
    );
    fireEvent.click(scholarLink);
    expect(openUrl).toHaveBeenCalledWith(
      "https://scholar.google.com/scholar?q=single%20cell",
    );
    expect(screen.getByRole("heading", { name: "报告生成中" })).toBeInTheDocument();
    expect(screen.getByLabelText("继续研究对话")).toBeDisabled();
    expect(screen.getByTestId("workspace")).toHaveClass("desktop-workspace");
  });

  it("collapses prior runs while keeping their messages and operations accessible", () => {
    const onSelectRun = vi.fn();
    render(
      <Workspace
        projectName="免疫耐药"
        run={{
          id: "run-current",
          projectId: "project-1",
          status: "running",
          stage: "search_sources",
          progress: 22,
          reportVersion: 0,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:00:10Z",
          completedAt: null,
        }}
        messages={[]}
        operations={[
          {
            id: "operation-current",
            runId: "run-current",
            sequence: 1,
            operationKind: "search_sources",
            stage: "search_sources",
            title: "当前运行多源检索",
            summary: "正在检索当前问题。",
            status: "running",
            createdAt: "2026-07-24T00:00:00Z",
          },
        ]}
        previousRuns={[previousRun]}
        onSelectRun={onSelectRun}
        report={null}
      />,
    );

    const historyQuestion = screen.getByText("旧问题：哪些耐药标志物值得关注？", {
      selector: ".history-run-question",
    });
    const history = historyQuestion.closest("details");
    expect(history).not.toHaveAttribute("open");
    expect(screen.getByText("1 次运行 · 点击展开")).toBeInTheDocument();
    expect(screen.getByText("当前运行多源检索")).toBeInTheDocument();
    expect(screen.getByText("当前运行 · 第 2 次")).toBeInTheDocument();

    fireEvent.click(historyQuestion);

    expect(history).toHaveAttribute("open");
    expect(onSelectRun).toHaveBeenCalledWith("run-history");
    expect(screen.getByText("旧运行多源检索")).toBeInTheDocument();
    expect(screen.getByText("本次报告已生成（完整内容见右侧报告）")).toBeInTheDocument();
    expect(screen.queryByText(/旧报告摘要不应再次占满/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /当前运行 · 第 2 次/ }));
    expect(onSelectRun).toHaveBeenCalledWith(null);
  });

  it("shows the complete report, exactly three plans, and traceable evidence", () => {
    const onExport = vi.fn();
    const { container } = render(
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
        report={{
          ...report,
          timeline: [
            "2010：早期文献建立了机制假设（evidence-1）；独立研究完成验证（evidence-2）。",
            "2026：最新研究完成多模态验证。",
          ],
          evidence: report.evidence.map((item) => ({
            ...item,
            journal: "Nature",
            issn: "0028-0836",
            impactFactor: 56.1,
            impactFactorYear: 2026,
            impactFactorSource: "LetPub（参考值）",
            impactFactorUrl: "https://www.letpub.com.cn/index.php?page=journalapp&view=search&searchissn=0028-0836",
          })),
          references: ["Evidence paper (pmid:1)"],
        }}
        onExport={onExport}
      />,
    );

    expect(screen.getByRole("heading", { name: report.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "进展时间线" })).toBeInTheDocument();
    expect(screen.getByText("2010")).toBeInTheDocument();
    expect(screen.getByText("早期文献建立了机制假设", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("独立研究完成验证（", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("evidence-2")).toBeInTheDocument();
    expect(container.querySelectorAll(".report-timeline li:first-child .timeline-studies p")).toHaveLength(2);
    const inlineEvidence = screen.getByRole("button", { name: "打开证据 evidence-1" });
    expect(inlineEvidence).toHaveClass("inline-evidence-link");
    const pmidLink = screen.getByRole("link", { name: "pmid:1" });
    expect(pmidLink).toHaveAttribute(
      "href",
      "https://pubmed.ncbi.nlm.nih.gov/1/",
    );
    fireEvent.click(pmidLink);
    expect(openUrl).toHaveBeenCalledWith("https://pubmed.ncbi.nlm.nih.gov/1/");
    fireEvent.click(inlineEvidence);
    expect(screen.getByLabelText("证据详情")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "主题版图" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "参考文献" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "影响因子" })).toBeInTheDocument();
    expect(screen.getByText("0028-0836")).toBeInTheDocument();
    const metricLink = screen.getByRole("link", { name: "56.1" });
    fireEvent.click(metricLink);
    expect(openUrl).toHaveBeenCalledWith(
      "https://www.letpub.com.cn/index.php?page=journalapp&view=search&searchissn=0028-0836",
    );
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

    expect(screen.getByLabelText("起始年份")).toHaveValue("2010");
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
