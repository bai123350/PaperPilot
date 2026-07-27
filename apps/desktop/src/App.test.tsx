import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { DesktopBridge } from "./bridge";
import type { RunEvent } from "./generated/contracts";

describe("desktop app shell", () => {
  it("loads local projects and opens the two-pane workspace", async () => {
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
      createProject: vi.fn(),
      startRun: vi.fn(),
      getRunSnapshot: vi.fn(),
      getReport: vi.fn(),
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      onRunEvent: vi.fn().mockResolvedValue(() => {}),
    };
    render(<App bridge={bridge} />);

    expect(await screen.findByRole("heading", { name: "本地研究项目" })).toBeInTheDocument();
    fireEvent.click((await screen.findByText("免疫耐药")).closest("button")!);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "研究对话" })).toBeInTheDocument(),
    );
    expect(screen.getByText("准备开始")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "报告生成中" })).toBeInTheDocument();
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
      createProject: vi.fn(),
      startRun: vi.fn(),
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
      sendMessage: vi.fn(),
      deleteProject: vi.fn(),
      onRunEvent: vi.fn().mockImplementation(async (listener: (event: RunEvent) => void) => {
        runEventListener = listener;
        return () => {};
      }),
    };
    render(<App bridge={bridge} />);
    fireEvent.click((await screen.findByText("Streaming project")).closest("button")!);
    await waitFor(() => expect(bridge.onRunEvent).toHaveBeenCalled());

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
});
