import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { NewProjectWorkflow } from "./new-project-workflow";

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("./run-workspace-client", () => ({
  RunWorkspaceClient: ({ runId }: { runId: string }) => (
    <div data-testid="embedded-run">{runId}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  routerMock.replace.mockReset();
});

describe("NewProjectWorkflow", () => {
  it("opens the run inline and synchronizes the App Router project URL", async () => {
    localStorage.setItem("paperpilot.conversationModel", "gpt-5-mini");
    vi.spyOn(api, "createProject").mockResolvedValue({
      id: "project-1",
      name: "Inline research",
      description: "",
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
    });
    vi.spyOn(api, "createRun").mockResolvedValue({
      id: "run-1",
      project_id: "project-1",
      status: "queued",
      stage: null,
      error: null,
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
      completed_at: null,
      report_version: 1,
    });
    vi.spyOn(api, "bootstrapRunConversation").mockResolvedValue({
      contract_version: "1.0",
      report_version: 1,
      messages: [],
    });

    render(<NewProjectWorkflow />);
    fireEvent.change(screen.getByLabelText("给 PaperPilot 发送研究问题"), {
      target: { value: "What evidence supports inline longitudinal biomarker research?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送研究问题" }));

    await waitFor(() => expect(screen.getByTestId("embedded-run")).toHaveTextContent("run-1"));
    expect(api.createRun).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ model: "gpt-5-mini" }),
    );
    expect(routerMock.replace).toHaveBeenCalledWith("/projects/project-1");
  });
});
