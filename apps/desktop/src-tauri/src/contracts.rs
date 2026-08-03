use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RunStatus {
    Queued,
    Running,
    Waiting,
    Retrying,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MessageAction {
    Discuss,
    ReviseReport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ExportFormat {
    Markdown,
    PrintHtml,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportResult {
    pub format: ExportFormat,
    pub suggested_filename: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResearchBrief {
    pub question: String,
    pub population: Option<String>,
    pub intervention: Option<String>,
    pub comparison: Option<String>,
    pub outcomes: Vec<String>,
    pub keywords: Vec<String>,
    pub date_from: Option<u16>,
    pub date_to: Option<u16>,
    pub study_types: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResearchRun {
    pub id: String,
    pub project_id: String,
    pub status: RunStatus,
    pub stage: Option<String>,
    pub progress: u8,
    pub report_version: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConversationMessage {
    pub id: String,
    pub run_id: String,
    #[ts(type = "number")]
    pub sequence: u64,
    pub role: String,
    pub content: String,
    pub evidence_ids: Vec<String>,
    pub report_version: Option<u32>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunOperation {
    pub id: String,
    pub run_id: String,
    #[ts(type = "number")]
    pub sequence: u64,
    pub operation_kind: String,
    pub stage: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunSnapshot {
    pub contract_version: String,
    pub run: ResearchRun,
    pub brief: ResearchBrief,
    pub messages: Vec<ConversationMessage>,
    pub operations: Vec<RunOperation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MessageResult {
    pub message: ConversationMessage,
    pub action: MessageAction,
    pub report_updated: bool,
    pub report_version: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunEvent {
    pub contract_version: String,
    pub run_id: String,
    #[ts(type = "number")]
    pub sequence: u64,
    pub status: RunStatus,
    pub stage: Option<String>,
    pub progress: u8,
    pub operation: Option<RunOperation>,
    pub safe_summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EvidenceRecord {
    pub id: String,
    pub run_id: String,
    pub paper_id: String,
    pub paper_title: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub genes: Vec<String>,
    #[serde(default)]
    pub findings: Vec<String>,
    #[serde(default)]
    pub journal: Option<String>,
    #[serde(default)]
    pub issn: Option<String>,
    #[serde(default)]
    pub impact_factor: Option<f32>,
    #[serde(default)]
    pub impact_factor_year: Option<u16>,
    #[serde(default)]
    pub impact_factor_source: Option<String>,
    #[serde(default)]
    pub impact_factor_url: Option<String>,
    pub excerpt: String,
    pub locator: String,
    pub evidence_type: String,
    pub confidence: f32,
    pub supports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Claim {
    pub id: String,
    pub statement: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Recommendation {
    pub id: String,
    pub title: String,
    pub rationale: String,
    pub hypothesis: String,
    pub minimal_validation: String,
    pub resources: Vec<String>,
    pub risks: Vec<String>,
    pub stop_condition: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DatasetModality {
    BulkRna,
    SingleCell,
    Spatial,
    AtacSeq,
    Genomics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PublicDataset {
    pub id: String,
    pub accession: String,
    pub title: String,
    pub source: String,
    pub modality: DatasetModality,
    pub organism: Option<String>,
    pub sample_count: Option<u32>,
    pub summary: String,
    pub data_types: Vec<String>,
    pub access: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Report {
    pub contract_version: String,
    pub schema_version: String,
    pub run_id: String,
    pub version: u32,
    pub title: String,
    pub summary: String,
    pub timeline: Vec<String>,
    pub themes: Vec<String>,
    pub claims: Vec<Claim>,
    #[serde(default)]
    pub related_datasets: Vec<PublicDataset>,
    pub controversies: Vec<String>,
    pub limitations: Vec<String>,
    pub gaps: Vec<String>,
    pub recommendations: Vec<Recommendation>,
    pub evidence: Vec<EvidenceRecord>,
    pub references: Vec<String>,
    pub disclaimer: String,
    pub created_at: DateTime<Utc>,
}

pub fn validate_report(report: &Report) -> Result<(), String> {
    if report.recommendations.len() != 3 {
        return Err("report must contain exactly three recommendations".into());
    }
    if report
        .claims
        .iter()
        .any(|claim| claim.evidence_ids.is_empty())
        || report
            .recommendations
            .iter()
            .any(|recommendation| recommendation.evidence_ids.is_empty())
    {
        return Err("every claim and recommendation must cite evidence".into());
    }

    let allowed: HashSet<&str> = report
        .evidence
        .iter()
        .filter(|record| record.run_id == report.run_id)
        .map(|record| record.id.as_str())
        .collect();
    let cited = report
        .claims
        .iter()
        .flat_map(|claim| claim.evidence_ids.iter())
        .chain(
            report
                .recommendations
                .iter()
                .flat_map(|recommendation| recommendation.evidence_ids.iter()),
        );
    if cited.into_iter().any(|id| !allowed.contains(id.as_str())) {
        return Err("report references evidence outside the current run".into());
    }
    Ok(())
}
