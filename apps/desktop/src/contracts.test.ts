import { describe, expect, it } from "vitest";

import { RUN_STATUSES } from "./generated/contracts";

describe("desktop contracts", () => {
  it("exposes only the seven persisted run statuses", () => {
    expect(RUN_STATUSES).toEqual([
      "queued",
      "running",
      "waiting",
      "retrying",
      "completed",
      "failed",
      "cancelled",
    ]);
  });
});
