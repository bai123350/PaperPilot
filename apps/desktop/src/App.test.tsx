import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { DesktopBridge } from "./bridge";
import type { RunEvent } from "./generated/contracts";

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
      getModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-chat",
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
      getModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-chat",
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
      getModelSettings: vi.fn().mockResolvedValue(null),
      saveModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-chat",
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
        model: "deepseek-chat",
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
      getModelSettings: vi.fn().mockResolvedValue({
        provider: "deepseek",
        model: "deepseek-chat",
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
});
