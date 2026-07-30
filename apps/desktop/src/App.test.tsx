import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { DesktopBridge } from "./bridge";
import type { Report, RunEvent, RunSnapshot } from "./generated/contracts";

const rerunBrief = {
  question: "比较肝癌巨噬细胞研究进展",
  population: "肝癌患者",
  intervention: null,
  comparison: null,
  outcomes: ["免疫抑制"],
  keywords: ["macrophage"],
  dateFrom: 2015,
  dateTo: 2026,
  studyTypes: ["cohort"],
};

describe("desktop app shell", () => {
  it("loads local projects and opens the two-pane workspace", async () => {
    let runEventHandler: ((event: RunEvent) => void) | undefined;
    const bridge: DesktopBridge = {
      listProjects: vi.fn().mockResolvedValue([
        {
          id: "project-1",
          name: "免疫耐药",
          description: "本地项目",
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      getLatestProjectRun: vi.fn().mockResolvedValue(null),
      getModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        configured: true,
        apiKeyHint: "••••1234",
      }),
      saveModelSettings: vi.fn(),
      createProject: vi.fn(),
      startRun: vi.fn(),
      retryRun: vi.fn(),
      getRunSnapshot: vi.fn().mockResolvedValue({
        contractVersion: "1.0",
        run: {
          id: "run-1",
          projectId: "project-1",
          status: "running",
          stage: "screen",
          progress: 44,
          reportVersion: 0,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:01:00Z",
          completedAt: null,
        },
        messages: [],
        operations: [],
      }),
      getReport: vi.fn(),
      exportReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      listenRunEvents: vi.fn().mockImplementation(async (handler) => {
        runEventHandler = handler;
        return vi.fn();
      }),
    };
    render(<App bridge={bridge} />);

    expect(await screen.findByRole("heading", { name: "本地研究项目" })).toBeInTheDocument();
    fireEvent.click((await screen.findByText("免疫耐药")).closest("button")!);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "研究对话" })).toBeInTheDocument(),
    );
    expect(screen.getByText("准备开始")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "报告生成中" })).toBeInTheDocument();

    await waitFor(() => expect(runEventHandler).toBeDefined());
    act(() => {
      runEventHandler?.({
        contractVersion: "1.0",
        runId: "run-1",
        sequence: 4,
        status: "running",
        stage: "screen",
        progress: 44,
        operation: null,
        safeSummary: "已完成相关性筛选。",
      });
    });
    expect(await screen.findByText("运行 44%")).toBeInTheDocument();
  });

  it("refreshes the active run when a persisted stage event arrives", async () => {
    let runEventListener: (event: RunEvent) => void = () => {};
    const bridge: DesktopBridge = {
      listProjects: vi.fn().mockResolvedValue([
        {
          id: "project-1",
          name: "Streaming project",
          description: "",
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      getLatestProjectRun: vi.fn().mockResolvedValue(null),
      getModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        configured: true,
        apiKeyHint: "••••1234",
      }),
      saveModelSettings: vi.fn(),
      createProject: vi.fn(),
      startRun: vi.fn(),
      retryRun: vi.fn(),
      getRunSnapshot: vi.fn().mockResolvedValue({
        contractVersion: "1.0",
        run: {
          id: "run-1",
          projectId: "project-1",
          status: "running",
          stage: "structure_question",
          progress: 11,
          reportVersion: 0,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:00:01Z",
          completedAt: null,
        },
        messages: [],
        operations: [
          {
            id: "operation-1",
            runId: "run-1",
            sequence: 1,
            operationKind: "structure_question",
            stage: "structure_question",
            title: "Stage one persisted",
            summary: "Safe stage summary",
            status: "completed",
            createdAt: "2026-07-24T00:00:01Z",
          },
        ],
      }),
      getReport: vi.fn(),
      exportReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      listenRunEvents: vi.fn().mockImplementation(async (listener: (event: RunEvent) => void) => {
        runEventListener = listener;
        return () => {};
      }),
    };
    render(<App bridge={bridge} />);
    fireEvent.click((await screen.findByText("Streaming project")).closest("button")!);
    await waitFor(() => expect(bridge.listenRunEvents).toHaveBeenCalled());

    runEventListener({
      contractVersion: "1.0",
      runId: "run-1",
      sequence: 1,
      status: "running",
      stage: "structure_question",
      progress: 11,
      operation: null,
      safeSummary: "Safe stage summary",
    });

    expect(await screen.findByText("Stage one persisted")).toBeInTheDocument();
    expect(bridge.getRunSnapshot).toHaveBeenCalledWith("run-1");

    vi.mocked(bridge.getRunSnapshot).mockResolvedValue({
      contractVersion: "1.0",
      run: {
        id: "run-1",
        projectId: "project-1",
        status: "running",
        stage: "search_sources",
        progress: 11,
        reportVersion: 0,
        createdAt: "2026-07-24T00:00:00Z",
        updatedAt: "2026-07-24T00:00:02Z",
        completedAt: null,
      },
      brief: rerunBrief,
      messages: [],
      operations: [
        {
          id: "operation-search",
          runId: "run-1",
          sequence: 1,
          operationKind: "search_sources",
          stage: "search_sources",
          title: "多源检索",
          summary: "Europe PMC 已完成\nPubMed 已完成",
          status: "completed",
          createdAt: "2026-07-24T00:00:02Z",
        },
      ],
    });
    runEventListener({
      contractVersion: "1.0",
      runId: "run-1",
      sequence: 1,
      status: "running",
      stage: "search_sources",
      progress: 11,
      operation: null,
      safeSummary: "PubMed 已完成",
    });
    expect(await screen.findByText(/PubMed 已完成/)).toBeInTheDocument();
  });

  it("requires local model settings before creating the first project", async () => {
    const project = {
      id: "project-1",
      name: "新研究",
      description: "",
      createdAt: "2026-07-27T00:00:00Z",
      updatedAt: "2026-07-27T00:00:00Z",
    };
    const bridge: DesktopBridge = {
      listProjects: vi.fn().mockResolvedValue([]),
      getLatestProjectRun: vi.fn().mockResolvedValue(null),
      getModelSettings: vi.fn().mockResolvedValue(null),
      saveModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        configured: true,
        apiKeyHint: "••••1234",
      }),
      createProject: vi.fn().mockResolvedValue(project),
      startRun: vi.fn(),
      retryRun: vi.fn(),
      getRunSnapshot: vi.fn(),
      getReport: vi.fn(),
      exportReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      listenRunEvents: vi.fn().mockResolvedValue(() => {}),
    };
    render(<App bridge={bridge} />);

    const name = await screen.findByLabelText("项目名称");
    fireEvent.change(name, { target: { value: "新研究" } });
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(await screen.findByRole("dialog", { name: "配置大模型服务" })).toBeInTheDocument();
    expect(bridge.createProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "sk-example-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));

    await waitFor(() =>
      expect(bridge.saveModelSettings).toHaveBeenCalledWith({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-example-1234",
      }),
    );
    await waitFor(() => expect(bridge.createProject).toHaveBeenCalledWith("新研究", ""));
    expect(await screen.findByRole("heading", { name: "研究对话" })).toBeInTheDocument();
  });

  it("stays on the project home when project creation fails", async () => {
    const bridge: DesktopBridge = {
      listProjects: vi.fn().mockResolvedValue([]),
      getLatestProjectRun: vi.fn().mockResolvedValue(null),
      getModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        configured: true,
        apiKeyHint: "••••1234",
      }),
      saveModelSettings: vi.fn(),
      createProject: vi.fn().mockRejectedValue(new Error("本地项目创建失败")),
      startRun: vi.fn(),
      retryRun: vi.fn(),
      getRunSnapshot: vi.fn(),
      getReport: vi.fn(),
      exportReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      listenRunEvents: vi.fn().mockResolvedValue(() => {}),
    };
    render(<App bridge={bridge} />);

    fireEvent.change(await screen.findByLabelText("项目名称"), {
      target: { value: "失败项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("本地项目创建失败");
    expect(screen.getByRole("heading", { name: "本地研究项目" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "研究对话" })).not.toBeInTheDocument();
  });

  it("creates a default-named project when the name field is empty", async () => {
    const project = {
      id: "project-default",
      name: "新研究项目 1",
      description: "",
      createdAt: "2026-07-28T00:00:00Z",
      updatedAt: "2026-07-28T00:00:00Z",
    };
    const bridge: DesktopBridge = {
      listProjects: vi.fn().mockResolvedValue([]),
      getLatestProjectRun: vi.fn().mockResolvedValue(null),
      getModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        configured: true,
        apiKeyHint: "••••1234",
      }),
      saveModelSettings: vi.fn(),
      createProject: vi.fn().mockResolvedValue(project),
      startRun: vi.fn(),
      retryRun: vi.fn(),
      getRunSnapshot: vi.fn(),
      getReport: vi.fn(),
      exportReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      listenRunEvents: vi.fn().mockResolvedValue(() => {}),
    };
    render(<App bridge={bridge} />);

    const create = await screen.findByRole("button", { name: "新建项目" });
    expect(create).toBeEnabled();
    fireEvent.click(create);

    await waitFor(() =>
      expect(bridge.createProject).toHaveBeenCalledWith("新研究项目 1", ""),
    );
    expect(await screen.findByRole("heading", { name: "研究对话" })).toBeInTheDocument();
  });

  it("restores the latest persisted conversation and report when opening a project", async () => {
    const completedRun = {
      id: "run-history",
      projectId: "project-history",
      status: "completed" as const,
      stage: "citation_audit",
      progress: 100,
      reportVersion: 1,
      createdAt: "2026-07-27T00:00:00Z",
      updatedAt: "2026-07-27T00:10:00Z",
      completedAt: "2026-07-27T00:10:00Z",
    };
    const bridge: DesktopBridge = {
      listProjects: vi.fn().mockResolvedValue([{
        id: "project-history",
        name: "历史研究",
        description: "",
        createdAt: "2026-07-27T00:00:00Z",
        updatedAt: "2026-07-27T00:10:00Z",
      }]),
      getLatestProjectRun: vi.fn().mockResolvedValue(completedRun),
      getModelSettings: vi.fn().mockResolvedValue(null),
      saveModelSettings: vi.fn(),
      createProject: vi.fn(),
      startRun: vi.fn().mockResolvedValue({
        ...completedRun,
        id: "run-rerun",
        status: "queued",
        stage: null,
        progress: 0,
        reportVersion: 0,
        completedAt: null,
      }),
      retryRun: vi.fn(),
      getRunSnapshot: vi.fn().mockResolvedValue({
        contractVersion: "1.0",
        run: completedRun,
        brief: rerunBrief,
        messages: [
          {
            id: "message-user",
            runId: "run-history",
            sequence: 10,
            role: "user",
            content: "上次保存的研究问题",
            evidenceIds: [],
            reportVersion: 1,
            createdAt: "2026-07-27T00:09:00Z",
          },
          {
            id: "message-assistant",
            runId: "run-history",
            sequence: 11,
            role: "assistant",
            content: "上次保存的模型回答",
            evidenceIds: ["evidence-history"],
            reportVersion: 1,
            createdAt: "2026-07-27T00:10:00Z",
          },
        ],
        operations: [],
      }),
      getReport: vi.fn().mockResolvedValue({
        contractVersion: "1.0",
        schemaVersion: "1.0",
        runId: "run-history",
        version: 1,
        title: "上次保存的完整报告",
        summary: "历史报告摘要",
        timeline: [],
        themes: [],
        claims: [],
        controversies: [],
        limitations: [],
        gaps: [],
        recommendations: [],
        evidence: [{
          id: "evidence-history",
          runId: "run-history",
          paperId: "pmid:1",
          paperTitle: "历史证据",
          journal: null,
          issn: null,
          impactFactor: null,
          impactFactorYear: null,
          impactFactorSource: null,
          impactFactorUrl: null,
          excerpt: "历史证据片段",
          locator: "abstract",
          evidenceType: "cohort",
          confidence: 0.9,
          supports: ["历史结论"],
        }],
        references: [],
        disclaimer: "仅供科研用途",
        createdAt: "2026-07-27T00:10:00Z",
      }),
      exportReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      listenRunEvents: vi.fn().mockResolvedValue(() => {}),
    };
    render(<App bridge={bridge} />);

    fireEvent.click((await screen.findByText("历史研究")).closest("button")!);

    expect(await screen.findByText("上次保存的研究问题")).toBeInTheDocument();
    expect(screen.getByText("上次保存的模型回答")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "上次保存的完整报告" })).toBeInTheDocument();
    expect(bridge.getLatestProjectRun).toHaveBeenCalledWith("project-history");
    expect(bridge.getRunSnapshot).toHaveBeenCalledWith("run-history");
    expect(bridge.getReport).toHaveBeenCalledWith("run-history");

    fireEvent.click(screen.getByRole("button", { name: "重新运行" }));
    expect(screen.getByDisplayValue(rerunBrief.question)).toBeInTheDocument();
    expect(screen.getByDisplayValue("2015")).toBeInTheDocument();
    expect(screen.getByText("修改后重新运行")).toBeInTheDocument();
    expect(screen.getByText("上次保存的模型回答")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消重跑" }));
    const composer = screen.getByLabelText("继续研究对话");
    fireEvent.change(composer, { target: { value: "重新生成报告从2012年开始" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(bridge.startRun).toHaveBeenCalledWith("project-history", {
        ...rerunBrief,
        dateFrom: 2012,
      }),
    );
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it("loads a selected historical run report and can return to the current report", async () => {
    const project = {
      id: "project-history-switch",
      name: "多次运行项目",
      description: "",
      createdAt: "2026-07-27T00:00:00Z",
      updatedAt: "2026-07-29T00:00:00Z",
    };
    const oldRun = {
      id: "run-old",
      projectId: project.id,
      status: "completed" as const,
      stage: "citation_audit",
      progress: 100,
      reportVersion: 1,
      createdAt: "2026-07-27T00:00:00Z",
      updatedAt: "2026-07-27T00:10:00Z",
      completedAt: "2026-07-27T00:10:00Z",
    };
    const currentRun = {
      ...oldRun,
      id: "run-current",
      createdAt: "2026-07-29T00:00:00Z",
      updatedAt: "2026-07-29T00:10:00Z",
      completedAt: "2026-07-29T00:10:00Z",
    };
    const snapshots: RunSnapshot[] = [
      {
        contractVersion: "1.0",
        run: oldRun,
        brief: { ...rerunBrief, question: "第一次运行的问题" },
        messages: [],
        operations: [],
      },
      {
        contractVersion: "1.0",
        run: currentRun,
        brief: { ...rerunBrief, question: "当前运行的问题" },
        messages: [],
        operations: [],
      },
    ];
    const reportFor = (runId: string, title: string): Report => ({
      contractVersion: "1.0",
      schemaVersion: "1.0",
      runId,
      version: 1,
      title,
      summary: `${title}摘要`,
      timeline: [],
      themes: [],
      claims: [],
      controversies: [],
      limitations: [],
      gaps: [],
      recommendations: [],
      evidence: [],
      references: [],
      disclaimer: "仅供科研用途",
      createdAt: "2026-07-29T00:10:00Z",
    });
    const bridge: DesktopBridge = {
      listProjects: vi.fn().mockResolvedValue([project]),
      getLatestProjectRun: vi.fn().mockResolvedValue(currentRun),
      listProjectRunSnapshots: vi.fn().mockResolvedValue(snapshots),
      getModelSettings: vi.fn().mockResolvedValue(null),
      saveModelSettings: vi.fn(),
      createProject: vi.fn(),
      startRun: vi.fn(),
      retryRun: vi.fn(),
      getRunSnapshot: vi.fn(),
      getReport: vi.fn().mockImplementation((runId: string) =>
        Promise.resolve(
          runId === oldRun.id
            ? reportFor(oldRun.id, "第一次运行报告")
            : reportFor(currentRun.id, "当前运行报告"),
        )),
      exportReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      listenRunEvents: vi.fn().mockResolvedValue(() => {}),
    };
    render(<App bridge={bridge} />);

    fireEvent.click((await screen.findByText(project.name)).closest("button")!);
    expect(
      await screen.findByRole("heading", { name: "当前运行报告" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("第一次运行的问题"));
    expect(
      await screen.findByRole("heading", { name: "第一次运行报告" }),
    ).toBeInTheDocument();
    expect(bridge.getReport).toHaveBeenCalledWith(oldRun.id);

    fireEvent.click(screen.getByRole("button", { name: /当前运行 · 第 2 次/ }));
    expect(
      await screen.findByRole("heading", { name: "当前运行报告" }),
    ).toBeInTheDocument();
  });
});
