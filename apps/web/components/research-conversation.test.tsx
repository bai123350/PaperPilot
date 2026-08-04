import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResearchConversation } from "./research-conversation";

afterEach(cleanup);

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

  it("turns a failed run composer into a retry action", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onSend = vi.fn();
    render(
      <ResearchConversation
        messages={[]}
        operations={[]}
        pending={false}
        canRevise={false}
        reportVersion={1}
        onSend={onSend}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByLabelText("给研究助手发送消息")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新运行研究" }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce());
    expect(onSend).not.toHaveBeenCalled();
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

  it("keeps report revision in the desktop-style composer menu", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchConversation
        messages={[]}
        operations={[]}
        pending={false}
        canRevise
        reportVersion={2}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByLabelText("添加"));
    fireEvent.click(screen.getByRole("button", { name: /据此修订报告/ }));
    fireEvent.change(screen.getByLabelText("给研究助手发送消息"), {
      target: { value: "补充这项局限" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("补充这项局限", "revise_report"));
  });

  it("offers the desktop models and reports model changes", () => {
    const onModelChange = vi.fn();
    render(
      <ResearchConversation
        messages={[]}
        operations={[]}
        pending={false}
        canRevise={false}
        reportVersion={1}
        model="deepseek-v4-flash"
        onModelChange={onModelChange}
        onSend={vi.fn()}
      />,
    );

    const modelPicker = screen.getByRole("combobox");
    expect(modelPicker).toHaveValue("deepseek-v4-flash");
    expect(screen.getByRole("option", { name: "V4 Pro" })).toBeInTheDocument();

    fireEvent.change(modelPicker, { target: { value: "deepseek-v4-pro" } });
    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-pro");
  });
});
