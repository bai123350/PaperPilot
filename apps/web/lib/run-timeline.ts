import type { RunConversationMessage, RunOperation } from "./api";

export type RunTimelineEntry =
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: RunConversationMessage;
    }
  | {
      kind: "operation";
      id: string;
      createdAt: string;
      sequence: number;
      operation: RunOperation;
    };

export function mergeRunTimeline(
  messages: RunConversationMessage[],
  operations: RunOperation[],
): RunTimelineEntry[] {
  const operationsById = new Map<string, RunOperation>();
  for (const operation of operations) operationsById.set(operation.id, operation);

  return [
    ...messages.map<RunTimelineEntry>((message) => ({
      kind: "message",
      id: message.id,
      createdAt: message.created_at,
      message,
    })),
    ...Array.from(operationsById.values()).map<RunTimelineEntry>((operation) => ({
      kind: "operation",
      id: operation.id,
      createdAt: operation.started_at,
      sequence: operation.sequence,
      operation,
    })),
  ].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    if (byTime !== 0) return byTime;
    const leftSequence = left.kind === "operation" ? left.sequence : Number.MAX_SAFE_INTEGER;
    const rightSequence = right.kind === "operation" ? right.sequence : Number.MAX_SAFE_INTEGER;
    return leftSequence - rightSequence || left.id.localeCompare(right.id);
  });
}
