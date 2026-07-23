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
        pending={false}
        canRevise={false}
        reportVersion={1}
        error="研究对话暂时不可用"
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("研究对话暂时不可用");
  });
});
