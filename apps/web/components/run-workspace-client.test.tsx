import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  getRun: vi.fn(),
  getRunConversation: vi.fn(),
  getRunOperations: vi.fn(),
  streamRunEvents: vi.fn(),
  retryRun: vi.fn(),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: apiMock };
});

import { RunWorkspaceClient } from "./run-workspace-client";

describe("RunWorkspaceClient", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getRun.mockResolvedValue({
      id: "run-1",
      project_id: "project-1",
      status: "failed",
      stage: "searching",
      error: "Research run failed",
      created_at: "2026-07-23T00:00:00Z",
      updated_at: "2026-07-23T00:00:02Z",
      completed_at: null,
      report_version: 1,
    });
    apiMock.getRunConversation.mockResolvedValue({
      contract_version: "1.0",
      report_version: 1,
      messages: [],
    });
    apiMock.getRunOperations.mockResolvedValue({
      contract_version: "1.0",
      operations: [{
        id: "operation-1",
        run_id: "run-1",
        sequence: 1,
        task_kind: "research_run",
        operation_kind: "search_source",
        stage: "searching",
        title: "检索文献来源",
        summary: "模型服务暂时不可用，可稍后重试。",
        status: "failed",
        metrics: {},
        conversation_message_id: null,
        started_at: "2026-07-23T00:00:01Z",
        completed_at: "2026-07-23T00:00:02Z",
      }],
    });
    apiMock.streamRunEvents.mockResolvedValue(undefined);
  });

  it("loads persisted operations into the conversation timeline", async () => {
    render(<RunWorkspaceClient runId="run-1" />);

    expect(await screen.findByText("检索文献来源")).toBeInTheDocument();
    expect(screen.getByText("模型服务暂时不可用，可稍后重试。")).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getRunOperations).toHaveBeenCalledWith("run-1"));
  });

  it("keeps the core workspace available when the operations endpoint is unavailable", async () => {
    apiMock.getRunOperations.mockRejectedValue(new Error("Not Found"));

    render(<RunWorkspaceClient runId="run-1" />);

    expect(await screen.findByText("尚未生成报告")).toBeInTheDocument();
    expect(screen.queryByText("Not Found")).not.toBeInTheDocument();
    await waitFor(() => expect(apiMock.getRun).toHaveBeenCalledWith("run-1"));
    await waitFor(() => expect(apiMock.getRunConversation).toHaveBeenCalledWith("run-1"));
  });
});
