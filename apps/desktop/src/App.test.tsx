import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { DesktopBridge } from "./bridge";

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
});
