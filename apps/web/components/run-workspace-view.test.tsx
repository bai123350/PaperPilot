import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunWorkspaceView } from "./run-workspace-view";

describe("RunWorkspaceView", () => {
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
    expect(screen.getByText("研究完成")).toBeInTheDocument();
  });
});
