import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StageRail } from "./stage-rail";

describe("StageRail", () => {
  it("marks the current stage and prior stages", () => {
    render(<StageRail currentStage="screening" status="running" />);

    expect(screen.getByText("相关性筛选").closest("li")).toHaveAttribute("data-state", "current");
    expect(screen.getByText("多源检索").closest("li")).toHaveAttribute("data-state", "complete");
    expect(screen.getByText("研究综合").closest("li")).toHaveAttribute("data-state", "pending");
  });
});
