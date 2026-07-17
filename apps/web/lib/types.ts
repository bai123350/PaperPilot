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
}
