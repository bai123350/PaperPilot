import { describe, expect, it } from "vitest";

import { mapReport } from "./report-mapper";

describe("mapReport", () => {
  it("joins evidence to paper titles and maps recommendation fields", () => {
    const report = mapReport({
      schema_version: "1.0",
      title: "Biomarker landscape",
      summary: "Evidence summary",
      themes: ["外部验证"],
      claims: [{ id: "c1", statement: "A supported claim", evidence_ids: ["e1"] }],
      evidence: [
        {
          id: "e1",
          paper_id: "p1",
          excerpt: "A sufficiently detailed excerpt from the source paper.",
          locator: "Abstract",
          evidence_type: "study_finding",
          confidence: 0.8,
          pmid: "123",
        },
      ],
      recommendations: [
        {
          id: "r1",
          title: "Validate externally",
          rationale: "Current evidence is incomplete.",
          hypothesis: "The effect persists.",
          minimal_validation: "Use an independent cohort.",
          resources: ["Biobank"],
          risks: ["Bias"],
          stop_condition: "Stop below 0.65.",
          evidence_ids: ["e1"],
        },
      ],
      papers: [{ id: "p1", title: "Prospective validation study" }],
      controversies: [],
      gaps: ["No external cohort"],
    });

    expect(report.schemaVersion).toBe("1.0");
    expect(report.evidence[0].paperTitle).toBe("Prospective validation study");
    expect(report.recommendations[0].minimalValidation).toBe("Use an independent cohort.");
  });
});
