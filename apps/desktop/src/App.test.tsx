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
      createProject: vi.fn(),
      startRun: vi.fn(),
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
});
