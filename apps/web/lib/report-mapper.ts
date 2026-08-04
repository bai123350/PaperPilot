import type { ReportViewModel } from "./types";

interface ApiPaper {
  id: string;
  title: string;
  authors?: string[];
  journal?: string | null;
  year?: number | null;
  pmid?: string | null;
  doi?: string | null;
  url?: string | null;
}

interface ApiEvidence {
  id: string;
  paper_id: string;
  excerpt: string;
  locator: string;
  pmid?: string | null;
  doi?: string | null;
}

interface ApiReport {
  schema_version: string;
  title: string;
  summary: string;
  timeline?: Array<{
    year: number;
    title: string;
    description: string;
    paper_ids: string[];
  }>;
  themes?: string[];
  claims: Array<{ id: string; statement: string; evidence_ids: string[] }>;
  evidence: ApiEvidence[];
  related_datasets?: Array<{
    id: string;
    accession: string;
    title: string;
    source: string;
    modality: "bulk_rna" | "single_cell" | "spatial" | "atac_seq" | "genomics";
    organism?: string | null;
    sample_count?: number | null;
    summary: string;
    data_types: string[];
    access: string;
    url: string;
  }>;
  recommendations: Array<{
    id: string;
    title: string;
    rationale: string;
    hypothesis: string;
    minimal_validation: string;
    resources: string[];
    risks: string[];
    stop_condition: string;
    evidence_ids: string[];
  }>;
  papers: ApiPaper[];
  controversies?: string[];
  gaps?: string[];
  disclaimer?: string;
}

export function mapReport(report: ApiReport): ReportViewModel {
  const paperTitles = new Map(report.papers.map((paper) => [paper.id, paper.title]));
  return {
    schemaVersion: report.schema_version,
    title: report.title,
    summary: report.summary,
    timeline: (report.timeline ?? []).map((item) => ({
      year: item.year,
      title: item.title,
      description: item.description,
      paperIds: item.paper_ids,
    })),
    themes: report.themes ?? [],
    controversies: report.controversies ?? [],
    gaps: report.gaps ?? [],
    relatedDatasets: (report.related_datasets ?? []).map((dataset) => ({
      id: dataset.id,
      accession: dataset.accession,
      title: dataset.title,
      source: dataset.source,
      modality: dataset.modality,
      organism: dataset.organism,
      sampleCount: dataset.sample_count,
      summary: dataset.summary,
      dataTypes: dataset.data_types,
      access: dataset.access,
      url: dataset.url,
    })),
    claims: report.claims.map((claim) => ({
      id: claim.id,
      statement: claim.statement,
      evidenceIds: claim.evidence_ids,
    })),
    evidence: report.evidence.map((item) => ({
      id: item.id,
      paperTitle: paperTitles.get(item.paper_id) ?? "未命名文献",
      excerpt: item.excerpt,
      locator: item.locator,
      pmid: item.pmid,
      doi: item.doi,
    })),
    recommendations: report.recommendations.map((item) => ({
      id: item.id,
      title: item.title,
      rationale: item.rationale,
      hypothesis: item.hypothesis,
      minimalValidation: item.minimal_validation,
      resources: item.resources,
      risks: item.risks,
      stopCondition: item.stop_condition,
      evidenceIds: item.evidence_ids,
    })),
    references: report.papers.map((paper) => ({
      id: paper.id,
      title: paper.title,
      authors: paper.authors ?? [],
      journal: paper.journal,
      year: paper.year,
      pmid: paper.pmid,
      doi: paper.doi,
      url: paper.url,
    })),
    disclaimer: report.disclaimer,
  };
}
