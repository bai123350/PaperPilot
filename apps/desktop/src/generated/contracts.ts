// Generated from Rust desktop contracts. Do not edit by hand.
export const RUN_STATUSES = ["queued", "running", "waiting", "retrying", "completed", "failed", "cancelled"] as const;

export type RunStatus = "queued" | "running" | "waiting" | "retrying" | "completed" | "failed" | "cancelled";

export type MessageAction = "discuss" | "revise_report";

export type ExportFormat = "markdown" | "print_html";

export type ExportResult = { format: ExportFormat, suggestedFilename: string, content: string, };

export type ResearchBrief = { question: string, population: string | null, intervention: string | null, comparison: string | null, outcomes: Array<string>, keywords: Array<string>, dateFrom: number | null, dateTo: number | null, studyTypes: Array<string>, };

export type Project = { id: string, name: string, description: string, createdAt: string, updatedAt: string, };

export type ResearchRun = { id: string, projectId: string, status: RunStatus, stage: string | null, progress: number, reportVersion: number, createdAt: string, updatedAt: string, completedAt: string | null, };

export type ConversationMessage = { id: string, runId: string, sequence: number, role: string, content: string, evidenceIds: Array<string>, reportVersion: number | null, createdAt: string, };

export type RunOperation = { id: string, runId: string, sequence: number, operationKind: string, stage: string, title: string, summary: string, status: string, createdAt: string, };

export type RunSnapshot = { contractVersion: string, run: ResearchRun, brief: ResearchBrief, messages: Array<ConversationMessage>, operations: Array<RunOperation>, };

export type MessageResult = { message: ConversationMessage, action: MessageAction, reportUpdated: boolean, reportVersion: number, };

export type RunEvent = { contractVersion: string, runId: string, sequence: number, status: RunStatus, stage: string | null, progress: number, operation: RunOperation | null, safeSummary: string, };

export type EvidenceRecord = { id: string, runId: string, paperId: string, paperTitle: string, excerpt: string, locator: string, evidenceType: string, confidence: number, supports: Array<string>, };

export type Claim = { id: string, statement: string, evidenceIds: Array<string>, };

export type Recommendation = { id: string, title: string, rationale: string, hypothesis: string, minimalValidation: string, resources: Array<string>, risks: Array<string>, stopCondition: string, evidenceIds: Array<string>, };

export type Report = { contractVersion: string, schemaVersion: string, runId: string, version: number, title: string, summary: string, timeline: Array<string>, themes: Array<string>, claims: Array<Claim>, controversies: Array<string>, limitations: Array<string>, gaps: Array<string>, recommendations: Array<Recommendation>, evidence: Array<EvidenceRecord>, references: Array<string>, disclaimer: string, createdAt: string, };
