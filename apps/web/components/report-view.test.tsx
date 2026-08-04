import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReportView } from "./report-view";

describe("ReportView", () => {
  it("shows evidence-backed claims and exactly three recommendations", () => {
    render(
      <ReportView
        report={{
          schemaVersion: "1.1",
          title: "Circulating biomarkers in treatment response",
          summary: "Prospective evidence is promising but externally validated cohorts remain limited.",
          claims: [
            {
              id: "claim-1",
              statement: "Prospective cohorts report useful discrimination.",
              evidenceIds: ["evidence-1"],
            },
          ],
          evidence: [
            {
              id: "evidence-1",
              paperTitle: "Prospective biomarker validation",
              excerpt: "The biomarker achieved an area under the curve of 0.82.",
              locator: "Results, p. 7",
              pmid: "12345678",
            },
          ],
          relatedDatasets: [
            {
              id: "dataset-single-cell",
              accession: "GSE12345",
              title: "Single-cell validation atlas",
              source: "NCBI GEO",
              modality: "single_cell",
              organism: "Homo sapiens",
              sampleCount: 24,
              summary: "A public single-cell cohort.",
              dataTypes: ["scRNA-seq"],
              access: "open",
              url: "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12345",
            },
            {
              id: "dataset-atac",
              accession: "ENCSR123ABC",
              title: "Chromatin accessibility atlas",
              source: "ENCODE",
              modality: "atac_seq",
              organism: "Homo sapiens",
              sampleCount: 8,
              summary: "Released ATAC-seq data.",
              dataTypes: ["ATAC-seq"],
              access: "open",
              url: "https://www.encodeproject.org/experiments/ENCSR123ABC/",
            },
          ],
          recommendations: ["Prospective validation", "External replication", "Assay harmonization"].map(
            (title, index) => ({
              id: `recommendation-${index}`,
              title,
              rationale: "The current evidence base is incomplete.",
              hypothesis: "Performance will remain stable in a new cohort.",
              minimalValidation: "Run a blinded prospective cohort study.",
              resources: ["Biobank"],
              risks: ["Spectrum bias"],
              stopCondition: "Stop if discrimination is below 0.65.",
              evidenceIds: ["evidence-1"],
            }),
          ),
        }}
      />,
    );

    expect(screen.getByText(/证据优先报告/)).toBeInTheDocument();
    expect(screen.getByText("Prospective cohorts report useful discrimination.")).toBeInTheDocument();
    expect(screen.getAllByTestId("recommendation-card")).toHaveLength(3);
    expect(screen.getAllByTestId("dataset-card")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /查看证据/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ATAC 1" }));
    expect(screen.getAllByTestId("dataset-card")).toHaveLength(1);
    expect(screen.getByText("Chromatin accessibility atlas")).toBeInTheDocument();
    expect(screen.queryByText("Single-cell validation atlas")).not.toBeInTheDocument();
  });
});
