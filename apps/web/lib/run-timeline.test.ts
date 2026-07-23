import { describe, expect, it } from "vitest";

import type { RunConversationMessage, RunOperation } from "./api";
import { mergeRunTimeline } from "./run-timeline";

const userMessage: RunConversationMessage = {
  id: "message-user",
  role: "user",
  content: "请比较长期证据。",
  evidence_ids: [],
  report_version: null,
  created_at: "2026-07-23T00:00:00Z",
};

const assistantMessage: RunConversationMessage = {
  id: "message-assistant",
  role: "assistant",
  content: "研究任务已经开始。",
  evidence_ids: [],
  report_version: null,
  created_at: "2026-07-23T00:00:02Z",
};

const operation: RunOperation = {
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
  conversation_message_id: "message-user",
  started_at: "2026-07-23T00:00:01Z",
  completed_at: "2026-07-23T00:00:01.500Z",
};

describe("mergeRunTimeline", () => {
  it("merges messages and operations in stable chronological order", () => {
    const entries = mergeRunTimeline(
      [assistantMessage, userMessage],
      [operation],
    );

    expect(entries.map((entry) => entry.id)).toEqual([
      "message-user",
      "operation-1",
      "message-assistant",
    ]);
  });

  it("uses the latest payload when an operation update repeats an id", () => {
    const entries = mergeRunTimeline(
      [],
      [{ ...operation, status: "running", summary: "正在检索一个文献来源。" }, operation],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("operation");
    if (entries[0].kind === "operation") {
      expect(entries[0].operation.status).toBe("completed");
    }
  });
});
