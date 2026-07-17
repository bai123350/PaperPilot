import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectGrid } from "./project-grid";

describe("ProjectGrid", () => {
  it("renders research projects with recent activity", () => {
    render(
      <ProjectGrid
        projects={[
          {
            id: "p1",
            name: "ctDNA response landscape",
            description: "Colorectal cancer cohorts",
            created_at: "2026-07-01T10:00:00Z",
            updated_at: "2026-07-17T10:00:00Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("ctDNA response landscape")).toBeInTheDocument();
    expect(screen.getByText("Colorectal cancer cohorts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开项目/i })).toHaveAttribute("href", "/projects/p1");
  });
});
