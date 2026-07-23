import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RunOperation } from "../lib/api";
import { OperationCard } from "./operation-card";

const completedOperation: RunOperation = {
  id: "operation-1",
  run_id: "run-1",
  sequence: 1,
  task_kind: "research_run",
  operation_kind: "search_source",
  stage: "searching",
  title: "检索文献来源",
  summary: "已完成文献来源检索，发现 42 篇候选文献。",
  status: "completed",
  metrics: { candidate_count: 42, duration_ms: 4800 },
  conversation_message_id: null,
  started_at: "2026-07-23T00:00:00Z",
  completed_at: "2026-07-23T00:00:04.800Z",
};

describe("OperationCard", () => {
  it("renders a completed operation with safe metrics and duration", () => {
    render(<OperationCard operation={completedOperation} />);

    expect(screen.getByRole("article", { name: "研究操作：检索文献来源" })).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText(completedOperation.summary)).toBeInTheDocument();
    expect(screen.getByText("42 篇候选文献")).toBeInTheDocument();
    expect(screen.getByText("4.8 秒")).toBeInTheDocument();
  });

  it("offers retry only for a failed initial research operation", () => {
    const onRetry = vi.fn();
    render(
      <OperationCard
        operation={{
          ...completedOperation,
          status: "failed",
          summary: "研究任务未能完成，可稍后重试。",
        }}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试研究任务" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
