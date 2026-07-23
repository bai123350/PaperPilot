import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RunWorkspaceView } from "./run-workspace-view";

afterEach(cleanup);

describe("RunWorkspaceView", () => {
  it("renders only a quiet report waiting state while research is running", () => {
    render(
      <RunWorkspaceView
        run={{
          id: "run-1",
          project_id: "project-1",
          status: "running",
          stage: "screening",
          error: null,
          created_at: "2026-07-17T10:00:00Z",
          updated_at: "2026-07-17T10:05:00Z",
          completed_at: null,
          report_version: 1,
        }}
        report={null}
      />,
    );

    expect(screen.getByText("报告准备中")).toBeInTheDocument();
    expect(screen.queryByText("研究流水线")).not.toBeInTheDocument();
    expect(screen.queryByText("运行信息")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/研究进度/)).not.toBeInTheDocument();
  });

  it("renders a quiet terminal state when no report was generated", () => {
    render(
      <RunWorkspaceView
        run={{
          id: "run-1",
          project_id: "project-1",
          status: "failed",
          stage: "searching",
          error: "Research run failed",
          created_at: "2026-07-17T10:00:00Z",
          updated_at: "2026-07-17T10:05:00Z",
          completed_at: null,
          report_version: 1,
        }}
        report={null}
      />,
    );

    expect(screen.getByText("尚未生成报告")).toBeInTheDocument();
    expect(screen.queryByText("Research run failed")).not.toBeInTheDocument();
  });

  it("renders a completed report in the run workspace", () => {
    render(
      <RunWorkspaceView
        run={{
          id: "run-1",
          project_id: "project-1",
          status: "completed",
          stage: "auditing",
          error: null,
          created_at: "2026-07-17T10:00:00Z",
          updated_at: "2026-07-17T10:10:00Z",
          completed_at: "2026-07-17T10:10:00Z",
          report_version: 1,
        }}
        report={{
          schemaVersion: "1.0",
          title: "Completed evidence report",
          summary: "A complete summary.",
          claims: [],
          evidence: [],
          recommendations: [],
        }}
      />,
    );

    expect(screen.getByText("Completed evidence report")).toBeInTheDocument();
    expect(screen.queryByText("报告准备中")).not.toBeInTheDocument();
  });
});
