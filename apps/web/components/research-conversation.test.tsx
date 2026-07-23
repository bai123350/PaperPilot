import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResearchConversation } from "./research-conversation";

describe("ResearchConversation", () => {
  it("shows an in-message streaming indicator before the first delta arrives", () => {
    render(
      <ResearchConversation
        messages={[{
          id: "pending-assistant",
          role: "assistant",
          content: "",
          evidence_ids: [],
          report_version: null,
          created_at: "2026-07-23T00:00:00Z",
        }]}
        operations={[]}
        pending
        canRevise={false}
        reportVersion={1}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("PaperPilot 正在生成回复")).toBeInTheDocument();
  });

  it("keeps a conversation error next to the composer", () => {
    render(
      <ResearchConversation
        messages={[]}
        operations={[]}
        pending={false}
        canRevise={false}
        reportVersion={1}
        error="研究对话暂时不可用"
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("研究对话暂时不可用");
  });

  it("interleaves complete operation cards with conversation messages", () => {
    const { container } = render(
      <ResearchConversation
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "开始研究",
            evidence_ids: [],
            report_version: null,
            created_at: "2026-07-23T00:00:00Z",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: "任务已经完成",
            evidence_ids: [],
            report_version: 1,
            created_at: "2026-07-23T00:00:02Z",
          },
        ]}
        operations={[{
          id: "operation-1",
          run_id: "run-1",
          sequence: 1,
          task_kind: "research_run",
          operation_kind: "search_source",
          stage: "searching",
          title: "检索文献来源",
          summary: "发现 42 篇候选文献。",
          status: "completed",
          metrics: { candidate_count: 42 },
          conversation_message_id: "user-1",
          started_at: "2026-07-23T00:00:01Z",
          completed_at: "2026-07-23T00:00:01.500Z",
        }]}
        pending={false}
        canRevise={false}
        reportVersion={1}
        onSend={vi.fn()}
      />,
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("开始研究")).toBeLessThan(text.indexOf("检索文献来源"));
    expect(text.indexOf("检索文献来源")).toBeLessThan(text.indexOf("任务已经完成"));
  });
});
