// Generated from Rust desktop contracts. Do not edit by hand.
export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "retrying",
  "completed",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchBrief {
  question: string;
  population: string | null;
  intervention: string | null;
  comparison: string | null;
  outcomes: string[];
  keywords: string[];
  dateFrom: number | null;
  dateTo: number | null;
  studyTypes: string[];
}

export interface ResearchRun {
  id: string;
  projectId: string;
  status: RunStatus;
  stage: string | null;
  progress: number;
  reportVersion: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ConversationMessage {
  id: string;
  runId: string;
  sequence: number;
  role: string;
  content: string;
  evidenceIds: string[];
  reportVersion: number | null;
  createdAt: string;
}

export interface RunOperation {
  id: string;
  runId: string;
  sequence: number;
  operationKind: string;
  stage: string;
  title: string;
  summary: string;
  status: string;
  createdAt: string;
}

export interface RunSnapshot {
  contractVersion: string;
  run: ResearchRun;
  messages: ConversationMessage[];
  operations: RunOperation[];
}

export type MessageAction = "discuss" | "revise_report";

export interface MessageResult {
  message: ConversationMessage;
  action: MessageAction;
  reportUpdated: boolean;
  reportVersion: number;
}

export interface EvidenceRecord {
  id: string;
  runId: string;
  paperId: string;
  paperTitle: string;
  excerpt: string;
  locator: string;
  evidenceType: string;
  confidence: number;
  supports: string[];
}

export interface Claim {
  id: string;
  statement: string;
  evidenceIds: string[];
}

export interface Recommendation {
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

export interface Report {
  contractVersion: string;
  schemaVersion: string;
  runId: string;
  version: number;
  title: string;
  summary: string;
  timeline: string[];
  themes: string[];
  claims: Claim[];
  controversies: string[];
  limitations: string[];
  gaps: string[];
  recommendations: Recommendation[];
  evidence: EvidenceRecord[];
  references: string[];
  disclaimer: string;
  createdAt: string;
}
