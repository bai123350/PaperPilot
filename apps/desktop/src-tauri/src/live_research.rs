use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use thiserror::Error;

use crate::{
    CONTRACT_VERSION,
    contracts::{Claim, EvidenceRecord, Recommendation, Report, ResearchBrief, validate_report},
    provider_settings::ModelClientConfig,
};

const MAX_PAPERS: usize = 8;
const MAX_EXCERPT_CHARS: usize = 2_400;

#[derive(Debug, Error)]
pub enum LiveResearchError {
    #[error("Europe PMC 文献检索连接失败。")]
    Search,
    #[error("Europe PMC 没有返回可用的相关文献摘要。")]
    NoEvidence,
    #[error("模型 API Key 无效或没有访问权限。")]
    ModelAuthentication,
    #[error("模型账户余额或配额不足。")]
    ModelQuota,
    #[error("模型名称或 API 地址不存在。")]
    ModelNotFound,
    #[error("模型服务请求过于频繁，请稍后重试。")]
    ModelRateLimited,
    #[error("模型服务暂时不可用或网络连接失败。")]
    Model,
    #[error("模型没有返回有效 JSON。")]
    InvalidJson,
    #[error("模型返回的检索式格式无效。")]
    InvalidSearchQuery,
    #[error("模型返回的证据抽取格式无效。")]
    InvalidEvidenceResponse,
    #[error("模型返回的报告格式无效。")]
    InvalidReportResponse,
    #[error("模型返回的追问回答格式无效。")]
    InvalidReplyResponse,
    #[error("模型引用了当前研究运行之外的证据。")]
    UnknownEvidence,
    #[error("模型生成的报告未通过引用审计。")]
    CitationAudit,
}

pub trait LiveResearchBackend: Send + Sync {
    fn collect_evidence(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError>;

    fn synthesize_report(
        &self,
        run_id: &str,
        version: u32,
        brief: &ResearchBrief,
        evidence: &[EvidenceRecord],
        revision_request: Option<&str>,
    ) -> Result<Report, LiveResearchError>;

    fn grounded_reply(
        &self,
        question: &str,
        report: &Report,
    ) -> Result<GroundedReply, LiveResearchError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroundedReply {
    pub content: String,
    pub evidence_ids: Vec<String>,
}

pub struct OpenAiResearchBackend {
    agent: ureq::Agent,
    config: ModelClientConfig,
}

impl OpenAiResearchBackend {
    pub fn new(config: ModelClientConfig) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(120)))
            .build()
            .into();
        Self { agent, config }
    }

    pub fn check_connection(&self) -> Result<(), LiveResearchError> {
        self.complete_json(
            "只输出 JSON。",
            json!({"task": "连接测试", "output_schema": {"ok": true}}),
        )
        .and_then(|value| {
            (value.get("ok").and_then(Value::as_bool) == Some(true))
                .then_some(())
                .ok_or(LiveResearchError::InvalidJson)
        })
    }

    fn complete_json(&self, system: &str, payload: Value) -> Result<Value, LiveResearchError> {
        let url = format!(
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );
        let mut request = json!({
            "model": self.config.model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": serde_json::to_string(&payload).map_err(|_| LiveResearchError::InvalidJson)?}
            ]
        });
        if matches!(
            self.config.provider.as_str(),
            "deepseek" | "openai" | "qwen"
        ) {
            request["response_format"] = json!({"type": "json_object"});
        }
        let mut response = self
            .agent
            .post(&url)
            .header("Authorization", &format!("Bearer {}", self.config.api_key))
            .send_json(request)
            .map_err(classify_model_error)?;
        let envelope: ChatCompletion = response
            .body_mut()
            .read_json()
            .map_err(|_| LiveResearchError::InvalidJson)?;
        let content = envelope
            .choices
            .first()
            .map(|choice| choice.message.content.trim())
            .filter(|content| !content.is_empty())
            .ok_or(LiveResearchError::InvalidJson)?;
        parse_json_content(content)
    }

    fn build_search_query(&self, brief: &ResearchBrief) -> Result<String, LiveResearchError> {
        let value = self.complete_json(
            "你是生物医学文献检索专家。把研究问题转换为简洁的英文 Europe PMC 布尔检索式。只输出 JSON，不回答研究问题。",
            json!({
                "research_brief": brief,
                "output_schema": {"query": "(English concept) AND (English concept)"}
            }),
        )?;
        let payload: SearchQuery =
            serde_json::from_value(value).map_err(|_| LiveResearchError::InvalidSearchQuery)?;
        let query = payload.query.trim();
        if query.is_empty() || query.chars().count() > 500 || query.contains(['\r', '\n']) {
            return Err(LiveResearchError::InvalidSearchQuery);
        }
        Ok(query.to_owned())
    }

    fn search(&self, query: &str) -> Result<Vec<SourcePaper>, LiveResearchError> {
        let mut response = self
            .agent
            .get("https://www.ebi.ac.uk/europepmc/webservices/rest/search")
            .query("query", query)
            .query("format", "json")
            .query("pageSize", "12")
            .query("resultType", "core")
            .call()
            .map_err(|_| LiveResearchError::Search)?;
        let response: EuropePmcResponse = response
            .body_mut()
            .read_json()
            .map_err(|_| LiveResearchError::Search)?;
        let papers = response
            .result_list
            .result
            .into_iter()
            .filter_map(SourcePaper::from_result)
            .take(MAX_PAPERS)
            .collect::<Vec<_>>();
        if papers.is_empty() {
            return Err(LiveResearchError::NoEvidence);
        }
        Ok(papers)
    }
}

impl LiveResearchBackend for OpenAiResearchBackend {
    fn collect_evidence(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        let query = self.build_search_query(brief)?;
        let papers = self.search(&query)?;
        let payload = json!({
            "task": "从真实文献摘要中筛选与研究问题直接相关的证据。不得补写摘要中不存在的事实。",
            "research_brief": brief,
            "sources": papers.iter().enumerate().map(|(index, paper)| json!({
                "source_index": index,
                "title": paper.title,
                "excerpt": paper.excerpt,
                "year": paper.year,
            })).collect::<Vec<_>>(),
            "output_schema": {
                "items": [{
                    "source_index": 0,
                    "support": "该摘要直接支持的简短结论",
                    "evidence_type": "study design or evidence type",
                    "confidence": 0.8
                }]
            }
        });
        let value = self.complete_json(
            "你是严谨的生物医学证据抽取器。只输出 JSON；只使用输入摘要；至少返回 1 条、最多每个来源 1 条。",
            payload,
        )?;
        let extracted: EvidenceExtractionPayload = serde_json::from_value(value)
            .map_err(|_| LiveResearchError::InvalidEvidenceResponse)?;
        let mut seen = std::collections::HashSet::new();
        let evidence = extracted
            .into_items()
            .into_iter()
            .filter(|item| item.source_index < papers.len() && seen.insert(item.source_index))
            .map(|item| {
                let source = &papers[item.source_index];
                EvidenceRecord {
                    id: format!("{run_id}-evidence-{}", item.source_index + 1),
                    run_id: run_id.into(),
                    paper_id: source.paper_id.clone(),
                    paper_title: source.title.clone(),
                    excerpt: source.excerpt.clone(),
                    locator: "abstract".into(),
                    evidence_type: item.evidence_type,
                    confidence: item.confidence.clamp(0.0, 1.0),
                    supports: vec![item.support],
                }
            })
            .collect::<Vec<_>>();
        if evidence.is_empty() {
            return Err(LiveResearchError::NoEvidence);
        }
        Ok(evidence)
    }

    fn synthesize_report(
        &self,
        run_id: &str,
        version: u32,
        brief: &ResearchBrief,
        evidence: &[EvidenceRecord],
        revision_request: Option<&str>,
    ) -> Result<Report, LiveResearchError> {
        let allowed_ids = evidence
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();
        let payload = json!({
            "task": if revision_request.is_some() { "根据新增约束修订完整研究报告" } else { "生成完整研究报告" },
            "research_brief": brief,
            "revision_request": revision_request,
            "allowed_evidence_ids": allowed_ids,
            "evidence": evidence,
            "requirements": {
                "claim_evidence_coverage": "100%",
                "recommendation_count": 3,
                "language": "zh-CN",
                "do_not_invent_sources": true,
                "disclaimer": "本报告仅供科研用途，不构成临床诊断或治疗建议。"
            },
            "output_schema": report_output_schema()
        });
        let value = self.complete_json(
            "你是 PaperPilot 生物医学研究综合器。只能引用 allowed_evidence_ids；必须输出严格 JSON；不得使用模型记忆补充未提供的研究结果；建议必须恰好三个。",
            payload,
        )?;
        let draft: ReportDraft =
            serde_json::from_value(value).map_err(|_| LiveResearchError::InvalidReportResponse)?;
        let report = draft.into_report(run_id, version, evidence.to_vec());
        validate_report(&report).map_err(|error| {
            if error.contains("outside") {
                LiveResearchError::UnknownEvidence
            } else {
                LiveResearchError::CitationAudit
            }
        })?;
        Ok(report)
    }

    fn grounded_reply(
        &self,
        question: &str,
        report: &Report,
    ) -> Result<GroundedReply, LiveResearchError> {
        let allowed_ids = report
            .evidence
            .iter()
            .map(|item| item.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let value = self.complete_json(
            "你是 PaperPilot 报告追问助手。仅依据输入 Evidence Record 回答；只输出 JSON；无法回答时明确说明证据不足。",
            json!({
                "question": question,
                "report_summary": report.summary,
                "allowed_evidence_ids": allowed_ids,
                "evidence": report.evidence,
                "output_schema": {"content": "回答", "evidence_ids": ["允许的 evidence id"]}
            }),
        )?;
        let reply: GroundedReplyPayload =
            serde_json::from_value(value).map_err(|_| LiveResearchError::InvalidReplyResponse)?;
        if reply
            .evidence_ids
            .iter()
            .any(|id| !allowed_ids.contains(id))
        {
            return Err(LiveResearchError::UnknownEvidence);
        }
        if reply.content.trim().is_empty() {
            return Err(LiveResearchError::InvalidReplyResponse);
        }
        Ok(GroundedReply {
            content: reply.content,
            evidence_ids: reply.evidence_ids,
        })
    }
}

#[derive(Debug, Deserialize)]
struct ChatCompletion {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EuropePmcResponse {
    result_list: EuropePmcResultList,
}

#[derive(Debug, Deserialize)]
struct EuropePmcResultList {
    result: Vec<EuropePmcResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EuropePmcResult {
    id: Option<String>,
    pmid: Option<String>,
    pmcid: Option<String>,
    doi: Option<String>,
    title: Option<String>,
    abstract_text: Option<String>,
    pub_year: Option<String>,
}

struct SourcePaper {
    paper_id: String,
    title: String,
    excerpt: String,
    year: Option<String>,
}

impl SourcePaper {
    fn from_result(result: EuropePmcResult) -> Option<Self> {
        let title = result.title?.trim().to_owned();
        let excerpt = truncate_chars(result.abstract_text?.trim(), MAX_EXCERPT_CHARS);
        if title.is_empty() || excerpt.is_empty() {
            return None;
        }
        let paper_id = result
            .pmid
            .map(|value| format!("pmid:{value}"))
            .or_else(|| result.pmcid.map(|value| format!("pmcid:{value}")))
            .or_else(|| result.doi.map(|value| format!("doi:{value}")))
            .or_else(|| result.id.map(|value| format!("europepmc:{value}")))?;
        Some(Self {
            paper_id,
            title,
            excerpt,
            year: result.pub_year,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum EvidenceExtractionPayload {
    Wrapped(EvidenceExtraction),
    Items(Vec<EvidenceItem>),
}

impl EvidenceExtractionPayload {
    fn into_items(self) -> Vec<EvidenceItem> {
        match self {
            Self::Wrapped(payload) => payload.items,
            Self::Items(items) => items,
        }
    }
}

#[derive(Debug, Deserialize)]
struct EvidenceExtraction {
    #[serde(
        alias = "evidence",
        alias = "evidence_records",
        alias = "evidenceRecords"
    )]
    items: Vec<EvidenceItem>,
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    query: String,
}

#[derive(Debug, Deserialize)]
struct EvidenceItem {
    #[serde(alias = "sourceIndex")]
    source_index: usize,
    #[serde(alias = "supports", alias = "claim", alias = "conclusion")]
    support: String,
    #[serde(alias = "evidenceType", alias = "type")]
    evidence_type: String,
    confidence: f32,
}

#[derive(Debug, Deserialize)]
struct GroundedReplyPayload {
    content: String,
    evidence_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ReportDraft {
    title: String,
    summary: String,
    timeline: Vec<String>,
    themes: Vec<String>,
    claims: Vec<Claim>,
    controversies: Vec<String>,
    limitations: Vec<String>,
    gaps: Vec<String>,
    recommendations: Vec<Recommendation>,
}

impl ReportDraft {
    fn into_report(self, run_id: &str, version: u32, evidence: Vec<EvidenceRecord>) -> Report {
        let references = evidence
            .iter()
            .map(|record| format!("{} ({})", record.paper_title, record.paper_id))
            .collect();
        Report {
            contract_version: CONTRACT_VERSION.into(),
            schema_version: "1.0".into(),
            run_id: run_id.into(),
            version,
            title: self.title,
            summary: self.summary,
            timeline: self.timeline,
            themes: self.themes,
            claims: self.claims,
            controversies: self.controversies,
            limitations: self.limitations,
            gaps: self.gaps,
            recommendations: self.recommendations,
            evidence,
            references,
            disclaimer: "本报告仅供科研用途，不构成临床诊断或治疗建议。".into(),
            created_at: Utc::now(),
        }
    }
}

fn report_output_schema() -> Value {
    json!({
        "title": "报告标题",
        "summary": "摘要",
        "timeline": ["进展时间线"],
        "themes": ["主题"],
        "claims": [{"id": "claim-1", "statement": "结论", "evidenceIds": ["allowed id"]}],
        "controversies": ["争议"],
        "limitations": ["局限"],
        "gaps": ["研究空白"],
        "recommendations": [{
            "id": "recommendation-1",
            "title": "方案标题",
            "rationale": "证据依据",
            "hypothesis": "可检验假设",
            "minimalValidation": "最小验证方案",
            "resources": ["数据与资源"],
            "risks": ["风险"],
            "stopCondition": "停止条件",
            "evidenceIds": ["allowed id"]
        }]
    })
}

fn parse_json_content(content: &str) -> Result<Value, LiveResearchError> {
    let trimmed = content.trim();
    if let Ok(value) = serde_json::from_str(trimmed) {
        return Ok(value);
    }
    if let Some(candidate) = json_object_slice(trimmed)
        && let Ok(value) = serde_json::from_str(candidate)
    {
        return Ok(value);
    }
    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .ok_or(LiveResearchError::InvalidJson)?;
    serde_json::from_str(without_fence).map_err(|_| LiveResearchError::InvalidJson)
}

fn json_object_slice(value: &str) -> Option<&str> {
    let start = value.find('{')?;
    let end = value.rfind('}')?;
    (start < end).then(|| &value[start..=end])
}

fn classify_model_error(error: ureq::Error) -> LiveResearchError {
    match error {
        ureq::Error::StatusCode(401 | 403) => LiveResearchError::ModelAuthentication,
        ureq::Error::StatusCode(402) => LiveResearchError::ModelQuota,
        ureq::Error::StatusCode(404) => LiveResearchError::ModelNotFound,
        ureq::Error::StatusCode(429) => LiveResearchError::ModelRateLimited,
        _ => LiveResearchError::Model,
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::{LiveResearchError, classify_model_error, parse_json_content, truncate_chars};

    #[test]
    fn accepts_plain_and_fenced_json_without_leaking_provider_text() {
        assert_eq!(parse_json_content(r#"{"ok":true}"#).unwrap()["ok"], true);
        assert_eq!(
            parse_json_content("```json\n{\"ok\":true}\n```").unwrap()["ok"],
            true
        );
        assert_eq!(
            parse_json_content("<think>internal</think>\n{\"ok\":true}").unwrap()["ok"],
            true
        );
        assert!(matches!(
            parse_json_content("not json"),
            Err(LiveResearchError::InvalidJson)
        ));
    }

    #[test]
    fn limits_excerpts_by_unicode_character_count() {
        assert_eq!(truncate_chars("中文摘要", 2), "中文");
    }

    #[test]
    fn classifies_safe_model_http_failures() {
        assert!(matches!(
            classify_model_error(ureq::Error::StatusCode(401)),
            LiveResearchError::ModelAuthentication
        ));
        assert!(matches!(
            classify_model_error(ureq::Error::StatusCode(402)),
            LiveResearchError::ModelQuota
        ));
        assert!(matches!(
            classify_model_error(ureq::Error::StatusCode(429)),
            LiveResearchError::ModelRateLimited
        ));
    }
}
