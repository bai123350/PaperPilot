export interface EvidenceView {
  id: string;
  paperTitle: string;
  excerpt: string;
  locator: string;
  pmid?: string | null;
  doi?: string | null;
}

export interface ClaimView {
  id: string;
  statement: string;
  evidenceIds: string[];
}

export interface RecommendationView {
  id: string;
  title: string;
  rationale: string;
  hypothesis: string;
  minimalValidation: string;
  resources: string[];
  risks: string[];
  stopCondition: string;
  evidenceIds: string[];
}

export type DatasetModality =
  | "bulk_rna"
  | "single_cell"
  | "spatial"
  | "atac_seq"
  | "genomics";

export interface PublicDatasetView {
  id: string;
  accession: string;
  title: string;
  source: string;
  modality: DatasetModality;
  organism?: string | null;
  sampleCount?: number | null;
  summary: string;
  dataTypes: string[];
  access: string;
  url: string;
}

export interface ReportViewModel {
  schemaVersion: string;
  title: string;
  summary: string;
  claims: ClaimView[];
  evidence: EvidenceView[];
  recommendations: RecommendationView[];
  themes?: string[];
  controversies?: string[];
  gaps?: string[];
  relatedDatasets?: PublicDatasetView[];
}
