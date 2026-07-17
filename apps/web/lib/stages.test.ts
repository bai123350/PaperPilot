import { describe, expect, it } from "vitest";

import { getStageProgress, researchStages } from "./stages";

describe("research stage progress", () => {
  it("keeps the public pipeline stages in evidence-first order", () => {
    expect(researchStages.map((stage) => stage.key)).toEqual([
      "planning",
      "searching",
      "deduplicating",
      "screening",
      "parsing",
      "extracting",
      "synthesizing",
      "recommending",
      "auditing",
    ]);
  });

  it("reports completed progress as one hundred percent", () => {
    expect(getStageProgress("completed", "auditing")).toBe(100);
  });
});
