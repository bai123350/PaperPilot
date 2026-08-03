use chrono::{Datelike, Utc};
use quick_xml::{Reader, XmlVersion, events::Event};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path};
use thiserror::Error;

use crate::{
    CONTRACT_VERSION,
    cancellation::CancellationToken,
    conclusion_skills::{ACTIVE_CONCLUSION_SKILLS, conclusion_skill_guidance},
    contracts::{
        Claim, ConversationMessage, EvidenceRecord, PublicDataset, Recommendation, Report,
        ResearchBrief, validate_report,
    },
    impact_factor::ImpactFactorLookup,
    provider_settings::ModelClientConfig,
    public_datasets,
};

const EUROPE_PMC_PAGE_SIZE: usize = 1_000;
const EUROPE_PMC_PAGE_SIZE_QUERY: &str = "1000";
const PUBMED_PAGE_SIZE: usize = 500;
const PUBMED_PAGE_SIZE_QUERY: &str = "500";
const PUBMED_MAX_RETRIEVABLE: usize = 10_000;
const OPENALEX_PAGE_SIZE: usize = 200;
const OPENALEX_PAGE_SIZE_QUERY: &str = "200";
const CROSSREF_PAGE_SIZE: usize = 500;
const CROSSREF_PAGE_SIZE_QUERY: &str = "500";
const CROSSREF_MAX_SEARCH_RESULTS: usize = 1_000;
const SOURCE_PAGE_DELAY_MS: u64 = 350;
const MIN_RELEVANCE_SCORE: f32 = 7.0;
const RANKING_BATCH_SIZE: usize = 10;
const MAX_RANKING_ATTEMPTS: usize = 3;
const EVIDENCE_BATCH_SIZE: usize = 8;
const MAX_EVIDENCE_ATTEMPTS: usize = 3;
const MAX_EXCERPT_CHARS: usize = 2_400;
const MAX_RANKING_EXCERPT_CHARS: usize = 700;
const MAX_REPORT_EVIDENCE_CHARS: usize = 1_200;
const MAX_MODEL_REQUEST_ATTEMPTS: usize = 3;
const EUROPE_PMC: &str = "Europe PMC";
const PUBMED: &str = "PubMed";
const OPENALEX: &str = "OpenAlex";
const CROSSREF: &str = "Crossref";
const GOOGLE_SCHOLAR: &str = "Google Scholar";

#[derive(Debug, Error)]
pub enum LiveResearchError {
    #[error("研究运行已由用户停止。")]
    Cancelled,
    #[error("所有文献数据库均检索失败。")]
    Search,
    #[error("文献数据库没有返回可用的相关文献摘要。")]
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
    #[error("模型返回的文献相关性评分格式无效。")]
    InvalidRankingResponse,
    #[error("模型返回的报告格式无效。")]
    InvalidReportResponse,
    #[error("模型返回的追问回答格式无效。")]
    InvalidReplyResponse,
    #[error("模型引用了当前研究运行之外的证据。")]
    UnknownEvidence,
    #[error("模型生成的报告未通过引用审计。")]
    CitationAudit,
}

#[derive(Debug, Clone, Copy)]
enum SourceSearchError {
    Cancelled,
    Connection,
    InvalidResponse,
}

impl std::fmt::Display for SourceSearchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "已停止",
            Self::Connection => "连接失败",
            Self::InvalidResponse => "响应无法解析",
        })
    }
}

pub trait LiveResearchBackend: Send + Sync {
    fn collect_evidence(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError>;

    fn collect_evidence_with_trace(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
        _on_trace: &mut dyn FnMut(LiveResearchTrace),
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        self.collect_evidence(run_id, brief)
    }

    fn search_public_datasets(&self, _brief: &ResearchBrief) -> Vec<PublicDataset> {
        Vec::new()
    }

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
        history: &[ConversationMessage],
    ) -> Result<GroundedReply, LiveResearchError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveResearchTrace {
    SearchQueryBuilt {
        query: String,
    },
    SourceSearchStarted {
        source: String,
    },
    ManualSourceSearchAvailable {
        source: String,
        url: String,
    },
    SourcesRetrieved {
        source: String,
        matched_count: usize,
        batch_count: usize,
        returned_count: usize,
        usable_count: usize,
        unique_count: usize,
        reached_limit: bool,
    },
    SourceRetrievalFailed {
        source: String,
        reason: String,
    },
    SourcesMerged {
        collected_count: usize,
        unique_count: usize,
        candidate_count: usize,
    },
    RankingProgress {
        evaluated_count: usize,
        total_count: usize,
        above_threshold_count: usize,
        ranked: Vec<RankedSource>,
    },
    SourcesRanked {
        evaluated_count: usize,
        above_threshold_count: usize,
        selected: Vec<RankedSource>,
    },
    EvidenceExtractionProgress {
        extracted_count: usize,
        total_count: usize,
    },
    EvidenceExtracted {
        selected_count: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankedSource {
    pub source: String,
    pub title: String,
    pub year: String,
    pub score: u8,
    pub reason: String,
    pub included: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroundedReply {
    pub content: String,
    pub evidence_ids: Vec<String>,
}

pub struct OpenAiResearchBackend {
    agent: ureq::Agent,
    config: ModelClientConfig,
    impact_factors: Option<ImpactFactorLookup>,
    cancellation: CancellationToken,
}

impl OpenAiResearchBackend {
    pub fn new(config: ModelClientConfig) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(300)))
            .build()
            .into();
        Self {
            agent,
            config,
            impact_factors: None,
            cancellation: CancellationToken::default(),
        }
    }

    pub fn with_impact_factor_cache(config: ModelClientConfig, data_dir: &Path) -> Self {
        let mut backend = Self::new(config);
        backend.impact_factors = Some(ImpactFactorLookup::open(data_dir));
        backend
    }

    pub fn with_cancellation(mut self, cancellation: CancellationToken) -> Self {
        self.cancellation = cancellation;
        self
    }

    fn ensure_not_cancelled(&self) -> Result<(), LiveResearchError> {
        if self.cancellation.is_cancelled() {
            Err(LiveResearchError::Cancelled)
        } else {
            Ok(())
        }
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
        self.ensure_not_cancelled()?;
        let url = format!(
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );
        let mut request = json!({
            "model": self.config.model,
            "temperature": 0.1,
            "max_tokens": 16384,
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
        if self.config.provider == "deepseek" {
            request["thinking"] = json!({"type": "disabled"});
        }
        let mut last_error = LiveResearchError::InvalidJson;
        for attempt in 0..MAX_MODEL_REQUEST_ATTEMPTS {
            self.ensure_not_cancelled()?;
            let response = self
                .agent
                .post(&url)
                .header("Authorization", &format!("Bearer {}", self.config.api_key))
                .send_json(request.clone());
            match response {
                Ok(mut response) => {
                    self.ensure_not_cancelled()?;
                    let parsed = response
                        .body_mut()
                        .read_json::<ChatCompletion>()
                        .map_err(|_| LiveResearchError::InvalidJson)
                        .and_then(|envelope| {
                            envelope
                                .choices
                                .first()
                                .map(|choice| choice.message.content.trim())
                                .filter(|content| !content.is_empty())
                                .ok_or(LiveResearchError::InvalidJson)
                                .and_then(parse_json_content)
                        });
                    match parsed {
                        Ok(value) => return Ok(value),
                        Err(error) => last_error = error,
                    }
                }
                Err(error) => {
                    let classified = classify_model_error(error);
                    if !matches!(
                        classified,
                        LiveResearchError::Model | LiveResearchError::ModelRateLimited
                    ) {
                        return Err(classified);
                    }
                    last_error = classified;
                }
            }
            if attempt + 1 < MAX_MODEL_REQUEST_ATTEMPTS {
                self.ensure_not_cancelled()?;
                std::thread::sleep(std::time::Duration::from_millis(750 * (attempt as u64 + 1)));
            }
        }
        Err(last_error)
    }

    fn build_search_query(&self, brief: &ResearchBrief) -> Result<String, LiveResearchError> {
        let (date_from, date_to) = effective_date_range(brief);
        let value = self.complete_json(
            "你是生物医学文献检索专家。把研究问题转换为简洁、可同时用于 Europe PMC、PubMed、OpenAlex、Crossref 和 Google Scholar 的英文检索式。使用核心概念和 AND/OR，不使用某个数据库独有的字段或日期语法；日期将由连接器单独过滤。检索概念必须来自研究问题、PICO 或用户关键词，避免自行扩展为宽泛上位词。只输出 JSON，不回答研究问题。",
            json!({
                "research_brief": brief,
                "effective_publication_range": {
                    "from": date_from,
                    "to": date_to
                },
                "output_schema": {"query": "(English concept) AND (English concept)"}
            }),
        )?;
        if let Ok(query) = parse_search_query_value(&value) {
            return Ok(query);
        }

        let repaired = self.complete_json(
            "你是检索式格式修复器。把 candidate 中已有的检索概念整理为一个跨数据库通用的英文 Boolean 检索式，不增加新概念。必须只返回一个 JSON 对象，格式严格为 {\"query\":\"(concept OR synonym) AND (concept)\"}；query 必须是单行字符串。",
            json!({
                "candidate": value,
                "research_question": brief.question,
                "user_keywords": brief.keywords,
            }),
        );
        match repaired {
            Ok(repaired) => {
                parse_search_query_value(&repaired).or_else(|_| fallback_search_query(brief))
            }
            Err(LiveResearchError::InvalidJson | LiveResearchError::InvalidSearchQuery) => {
                fallback_search_query(brief)
            }
            Err(error) => Err(error),
        }
    }

    fn search_europe_pmc(
        &self,
        query: &str,
        brief: &ResearchBrief,
    ) -> Result<SearchResults, SourceSearchError> {
        let (date_from, date_to) = effective_date_range(brief);
        let dated_query =
            format!("({query}) AND FIRST_PDATE:[{date_from}-01-01 TO {date_to}-12-31]");
        let mut cursor = "*".to_owned();
        let mut keyword_matched_count = 0;
        let mut returned_count = 0;
        let mut batch_count = 0;
        let mut papers = Vec::new();
        loop {
            if self.cancellation.is_cancelled() {
                return Err(SourceSearchError::Cancelled);
            }
            let mut response = self
                .agent
                .get("https://www.ebi.ac.uk/europepmc/webservices/rest/search")
                .query("query", &dated_query)
                .query("format", "json")
                .query("pageSize", EUROPE_PMC_PAGE_SIZE_QUERY)
                .query("cursorMark", &cursor)
                .query("resultType", "core")
                .call()
                .map_err(|_| SourceSearchError::Connection)?;
            let response: EuropePmcResponse = response
                .body_mut()
                .read_json()
                .map_err(|_| SourceSearchError::InvalidResponse)?;
            let batch_size = response.result_list.result.len();
            if batch_size == 0 {
                break;
            }
            batch_count += 1;
            returned_count += batch_size;
            for result in response.result_list.result {
                if let Some(paper) = SourcePaper::from_europe_pmc(result)
                    && source_paper_abstract_contains_query_keyword(&paper, query)
                {
                    keyword_matched_count += 1;
                    papers.push(paper);
                }
            }
            let Some(next_cursor) = response.next_cursor_mark else {
                break;
            };
            if batch_size < EUROPE_PMC_PAGE_SIZE || next_cursor == cursor {
                break;
            }
            cursor = next_cursor;
            std::thread::sleep(std::time::Duration::from_millis(SOURCE_PAGE_DELAY_MS));
        }
        Ok(SearchResults::new(
            keyword_matched_count,
            batch_count,
            returned_count,
            papers,
        ))
    }

    fn search_pubmed(
        &self,
        query: &str,
        brief: &ResearchBrief,
    ) -> Result<SearchResults, SourceSearchError> {
        let (date_from, date_to) = effective_date_range(brief);
        let dated_query = format!(
            "({query}) AND (\"{date_from}/01/01\"[Date - Publication] : \"{date_to}/12/31\"[Date - Publication])"
        );
        let mut keyword_matched_count = 0;
        let mut returned_count = 0;
        let mut batch_count = 0;
        let mut reached_limit = false;
        let mut papers = Vec::new();
        let mut retstart = 0;
        loop {
            if self.cancellation.is_cancelled() {
                return Err(SourceSearchError::Cancelled);
            }
            let mut response = self
                .agent
                .get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")
                .query("db", "pubmed")
                .query("retmode", "json")
                .query("retstart", &retstart.to_string())
                .query("retmax", PUBMED_PAGE_SIZE_QUERY)
                .query("sort", "relevance")
                .query("tool", "PaperPilot")
                .query("term", &dated_query)
                .call()
                .map_err(|_| SourceSearchError::Connection)?;
            let response: PubMedSearchResponse = response
                .body_mut()
                .read_json()
                .map_err(|_| SourceSearchError::InvalidResponse)?;
            let provider_matched_count = response
                .esearchresult
                .count
                .parse::<usize>()
                .map_err(|_| SourceSearchError::InvalidResponse)?;
            let ids = response.esearchresult.idlist;
            if ids.is_empty() {
                break;
            }
            let batch_size = ids.len();
            batch_count += 1;
            returned_count += batch_size;
            let mut response = self
                .agent
                .get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi")
                .query("db", "pubmed")
                .query("retmode", "xml")
                .query("tool", "PaperPilot")
                .query("id", &ids.join(","))
                .call()
                .map_err(|_| SourceSearchError::Connection)?;
            let body = response
                .body_mut()
                .read_to_string()
                .map_err(|_| SourceSearchError::InvalidResponse)?;
            for paper in parse_pubmed_xml(&body)? {
                if source_paper_abstract_contains_query_keyword(&paper, query) {
                    keyword_matched_count += 1;
                    papers.push(paper);
                }
            }
            retstart += batch_size;
            if batch_size < PUBMED_PAGE_SIZE
                || retstart >= provider_matched_count
                || retstart >= PUBMED_MAX_RETRIEVABLE
            {
                reached_limit =
                    retstart >= PUBMED_MAX_RETRIEVABLE && retstart < provider_matched_count;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(SOURCE_PAGE_DELAY_MS));
        }
        let mut results =
            SearchResults::new(keyword_matched_count, batch_count, returned_count, papers);
        results.reached_limit = reached_limit;
        Ok(results)
    }

    fn search_openalex(
        &self,
        query: &str,
        brief: &ResearchBrief,
    ) -> Result<SearchResults, SourceSearchError> {
        let (date_from, date_to) = effective_date_range(brief);
        let filter = format!(
            "from_publication_date:{date_from}-01-01,to_publication_date:{date_to}-12-31,has_abstract:true,title_and_abstract.search:{query}"
        );
        let mut keyword_matched_count = 0;
        let mut returned_count = 0;
        let mut batch_count = 0;
        let mut papers = Vec::new();
        let mut cursor = "*".to_owned();
        loop {
            if self.cancellation.is_cancelled() {
                return Err(SourceSearchError::Cancelled);
            }
            let mut response = self
                .agent
                .get("https://api.openalex.org/works")
                .query("cursor", &cursor)
                .query("per-page", OPENALEX_PAGE_SIZE_QUERY)
                .query("filter", &filter)
                .query("sort", "relevance_score:desc")
                .query(
                    "select",
                    "id,doi,title,publication_year,ids,primary_location,abstract_inverted_index",
                )
                .call()
                .map_err(|_| SourceSearchError::Connection)?;
            let response: OpenAlexResponse = response
                .body_mut()
                .read_json()
                .map_err(|_| SourceSearchError::InvalidResponse)?;
            let batch_size = response.results.len();
            if batch_size == 0 {
                break;
            }
            batch_count += 1;
            returned_count += batch_size;
            for work in response.results {
                if let Some(paper) = SourcePaper::from_openalex(work)
                    && source_paper_abstract_contains_query_keyword(&paper, query)
                {
                    keyword_matched_count += 1;
                    papers.push(paper);
                }
            }
            let Some(next_cursor) = response.meta.next_cursor else {
                break;
            };
            if batch_size < OPENALEX_PAGE_SIZE || next_cursor == cursor {
                break;
            }
            cursor = next_cursor;
            std::thread::sleep(std::time::Duration::from_millis(SOURCE_PAGE_DELAY_MS));
        }
        Ok(SearchResults::new(
            keyword_matched_count,
            batch_count,
            returned_count,
            papers,
        ))
    }

    fn search_crossref(
        &self,
        query: &str,
        brief: &ResearchBrief,
    ) -> Result<SearchResults, SourceSearchError> {
        let (date_from, date_to) = effective_date_range(brief);
        let filter = format!(
            "from-pub-date:{date_from}-01-01,until-pub-date:{date_to}-12-31,has-abstract:true"
        );
        let mut keyword_matched_count = 0;
        let mut returned_count = 0;
        let mut batch_count = 0;
        let mut papers = Vec::new();
        let mut cursor = "*".to_owned();
        loop {
            if self.cancellation.is_cancelled() {
                return Err(SourceSearchError::Cancelled);
            }
            let mut response = self
                .agent
                .get("https://api.crossref.org/works")
                .header("User-Agent", "PaperPilot/0.1")
                .query("query.bibliographic", query)
                .query("rows", CROSSREF_PAGE_SIZE_QUERY)
                .query("cursor", &cursor)
                .query("filter", &filter)
                .query(
                    "select",
                    "DOI,title,abstract,published,container-title,ISSN",
                )
                .call()
                .map_err(|_| SourceSearchError::Connection)?;
            let response: CrossrefResponse = response
                .body_mut()
                .read_json()
                .map_err(|_| SourceSearchError::InvalidResponse)?;
            let batch_size = response.message.items.len();
            if batch_size == 0 {
                break;
            }
            batch_count += 1;
            returned_count += batch_size;
            for work in response.message.items {
                if let Some(paper) = SourcePaper::from_crossref(work)
                    && source_paper_abstract_contains_query_keyword(&paper, query)
                {
                    keyword_matched_count += 1;
                    papers.push(paper);
                }
            }
            let Some(next_cursor) = response.message.next_cursor else {
                break;
            };
            if batch_size < CROSSREF_PAGE_SIZE
                || next_cursor == cursor
                || returned_count >= CROSSREF_MAX_SEARCH_RESULTS
            {
                break;
            }
            cursor = next_cursor;
            std::thread::sleep(std::time::Duration::from_millis(SOURCE_PAGE_DELAY_MS));
        }
        Ok(SearchResults::new(
            keyword_matched_count,
            batch_count,
            returned_count,
            papers,
        ))
    }

    fn search_all_sources(
        &self,
        query: &str,
        brief: &ResearchBrief,
        on_trace: &mut dyn FnMut(LiveResearchTrace),
    ) -> Result<Vec<SourcePaper>, LiveResearchError> {
        self.ensure_not_cancelled()?;
        let mut successful_sources = 0;
        let mut collected = Vec::new();

        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: EUROPE_PMC.into(),
        });
        record_source_result(
            EUROPE_PMC,
            self.search_europe_pmc(query, brief),
            &mut successful_sources,
            &mut collected,
            on_trace,
        );
        self.ensure_not_cancelled()?;

        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: PUBMED.into(),
        });
        record_source_result(
            PUBMED,
            self.search_pubmed(query, brief),
            &mut successful_sources,
            &mut collected,
            on_trace,
        );
        self.ensure_not_cancelled()?;

        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: OPENALEX.into(),
        });
        record_source_result(
            OPENALEX,
            self.search_openalex(query, brief),
            &mut successful_sources,
            &mut collected,
            on_trace,
        );
        self.ensure_not_cancelled()?;

        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: CROSSREF.into(),
        });
        record_source_result(
            CROSSREF,
            self.search_crossref(query, brief),
            &mut successful_sources,
            &mut collected,
            on_trace,
        );
        self.ensure_not_cancelled()?;

        let (date_from, date_to) = effective_date_range(brief);
        on_trace(LiveResearchTrace::ManualSourceSearchAvailable {
            source: GOOGLE_SCHOLAR.into(),
            url: google_scholar_search_url(query, date_from, date_to),
        });

        if successful_sources == 0 {
            return Err(LiveResearchError::Search);
        }
        if collected.is_empty() {
            return Err(LiveResearchError::NoEvidence);
        }

        let collected_count = collected.len();
        let merged = merge_duplicate_papers(collected);
        let unique_count = merged.len();
        let papers = merged;
        on_trace(LiveResearchTrace::SourcesMerged {
            collected_count,
            unique_count,
            candidate_count: papers.len(),
        });
        if papers.is_empty() {
            return Err(LiveResearchError::NoEvidence);
        }
        Ok(papers)
    }

    fn collect_evidence_internal(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
        on_trace: &mut dyn FnMut(LiveResearchTrace),
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        self.ensure_not_cancelled()?;
        let query = self.build_search_query(brief)?;
        let (date_from, date_to) = effective_date_range(brief);
        on_trace(LiveResearchTrace::SearchQueryBuilt {
            query: format!("{query}\n发表时间范围：{date_from}–{date_to}"),
        });
        let candidate_papers = self.search_all_sources(&query, brief, on_trace)?;
        self.ensure_not_cancelled()?;
        let ranked = self.rank_papers(brief, &candidate_papers, on_trace)?;
        self.ensure_not_cancelled()?;
        let above_threshold_count = ranked
            .iter()
            .filter(|item| item.score >= MIN_RELEVANCE_SCORE)
            .count();
        let selected_ranked = ranked
            .iter()
            .filter(|item| item.score >= MIN_RELEVANCE_SCORE)
            .collect::<Vec<_>>();
        if selected_ranked.is_empty() {
            return Err(LiveResearchError::NoEvidence);
        }
        on_trace(LiveResearchTrace::SourcesRanked {
            evaluated_count: ranked.len(),
            above_threshold_count,
            selected: ranked
                .iter()
                .map(|item| ranked_source(item, &candidate_papers[item.source_index]))
                .collect(),
        });
        let evidence = self.extract_evidence_batches(
            run_id,
            brief,
            &candidate_papers,
            &selected_ranked,
            on_trace,
        )?;
        if evidence.is_empty() {
            return Err(LiveResearchError::NoEvidence);
        }
        on_trace(LiveResearchTrace::EvidenceExtracted {
            selected_count: evidence.len(),
        });
        Ok(evidence)
    }

    fn rank_papers(
        &self,
        brief: &ResearchBrief,
        papers: &[SourcePaper],
        on_trace: &mut dyn FnMut(LiveResearchTrace),
    ) -> Result<Vec<RankedPaper>, LiveResearchError> {
        let mut ranked = Vec::with_capacity(papers.len());
        for (batch_number, batch) in papers.chunks(RANKING_BATCH_SIZE).enumerate() {
            self.ensure_not_cancelled()?;
            let batch_start = batch_number * RANKING_BATCH_SIZE;
            let indices = (batch_start..batch_start + batch.len()).collect::<Vec<_>>();
            let mut batch_ranked = self.rank_paper_subset(brief, papers, &indices)?;
            ranked.append(&mut batch_ranked);
            let mut progress = ranked
                .iter()
                .map(|item| ranked_source(item, &papers[item.source_index]))
                .collect::<Vec<_>>();
            progress.sort_by(|left, right| right.score.cmp(&left.score));
            on_trace(LiveResearchTrace::RankingProgress {
                evaluated_count: ranked.len(),
                total_count: papers.len(),
                above_threshold_count: ranked
                    .iter()
                    .filter(|item| item.score >= MIN_RELEVANCE_SCORE)
                    .count(),
                ranked: progress,
            });
        }
        ranked.sort_by(|left, right| right.score.total_cmp(&left.score));
        if ranked.len() != papers.len() {
            return Err(LiveResearchError::InvalidRankingResponse);
        }
        Ok(ranked)
    }

    fn rank_paper_subset(
        &self,
        brief: &ResearchBrief,
        papers: &[SourcePaper],
        source_indices: &[usize],
    ) -> Result<Vec<RankedPaper>, LiveResearchError> {
        let mut pending = source_indices.to_vec();
        let mut completed = HashMap::<usize, RankedPaper>::new();
        for _ in 0..MAX_RANKING_ATTEMPTS {
            if pending.is_empty() {
                break;
            }
            let requested = pending.clone();
            let value = match self.complete_json(
                "你是生物医学文献相关性评审器。必须逐篇解读每个输入来源，为每篇按与研究问题的直接相关程度给出 0–20 分；不得遗漏任何 source_index；只输出一个包含 items 数组的 JSON 对象。分数必须是数字，理由使用 reason 字段。",
                json!({
                    "research_brief": brief,
                    "scoring": {
                        "0_to_3": "主题无关",
                        "4_to_6": "仅弱背景相关，不应纳入证据",
                        "7_to_13": "与问题直接相关且可提取至少一条证据",
                        "14_to_20": "高度直接相关且证据明确"
                    },
                    "sources": requested.iter().enumerate().map(|(local_index, source_index)| {
                        let paper = &papers[*source_index];
                        json!({
                            "source_index": local_index,
                            "databases": paper.sources,
                            "title": paper.title,
                            "abstract_excerpt": truncate_chars(&paper.excerpt, MAX_RANKING_EXCERPT_CHARS),
                            "year": paper.year,
                        })
                    }).collect::<Vec<_>>(),
                    "output_schema": {
                        "items": [{
                            "source_index": 0,
                            "relevance_score": 16,
                            "reason": "这篇文献与当前问题相关或不相关的具体原因"
                        }]
                    }
                }),
            ) {
                Ok(value) => value,
                Err(
                    LiveResearchError::InvalidJson
                    | LiveResearchError::Model
                    | LiveResearchError::ModelRateLimited,
                ) => break,
                Err(error) => return Err(error),
            };
            let payload: RankingPayload = match serde_json::from_value(value) {
                Ok(payload) => payload,
                Err(_) => continue,
            };
            let mut seen_local = std::collections::HashSet::new();
            for item in payload.into_items() {
                let Some(local_index) = parse_usize_value(&item.source_index) else {
                    continue;
                };
                let Some(score) = parse_score_value(&item.relevance_score) else {
                    continue;
                };
                if local_index >= requested.len() || !seen_local.insert(local_index) {
                    continue;
                }
                let source_index = requested[local_index];
                let reason = item
                    .reason
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("模型已完成相关性评分，但未返回单独理由。")
                    .to_owned();
                completed.insert(
                    source_index,
                    RankedPaper {
                        source_index,
                        score: score.clamp(0.0, 20.0),
                        reason,
                    },
                );
            }
            pending.retain(|source_index| !completed.contains_key(source_index));
        }
        for source_index in pending {
            completed.insert(
                source_index,
                RankedPaper {
                    source_index,
                    score: 0.0,
                    reason: "模型多次未返回该篇的有效评分，已保留检索记录但不纳入证据。".into(),
                },
            );
        }
        Ok(source_indices
            .iter()
            .filter_map(|source_index| completed.remove(source_index))
            .collect())
    }

    fn extract_evidence_batches(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
        papers: &[SourcePaper],
        selected: &[&RankedPaper],
        on_trace: &mut dyn FnMut(LiveResearchTrace),
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        let mut evidence = Vec::with_capacity(selected.len());
        for batch in selected.chunks(EVIDENCE_BATCH_SIZE) {
            self.ensure_not_cancelled()?;
            let items = self.extract_evidence_subset(brief, papers, batch)?;
            for item in items {
                self.ensure_not_cancelled()?;
                let ranked = batch[item.batch_index];
                let source = &papers[ranked.source_index];
                let metric = self.impact_factors.as_ref().and_then(|lookup| {
                    lookup.lookup(source.journal.as_deref(), source.issn.as_deref())
                });
                let evidence_number = evidence.len() + 1;
                evidence.push(EvidenceRecord {
                    id: format!("{run_id}-evidence-{evidence_number}"),
                    run_id: run_id.into(),
                    paper_id: source.paper_id.clone(),
                    paper_title: source.title.clone(),
                    authors: source.authors.clone(),
                    genes: item.genes,
                    findings: item.findings,
                    journal: source
                        .journal
                        .clone()
                        .or_else(|| metric.as_ref().map(|item| item.journal.clone())),
                    issn: source
                        .issn
                        .clone()
                        .or_else(|| metric.as_ref().map(|item| item.issn.clone())),
                    impact_factor: metric.as_ref().map(|item| item.impact_factor),
                    impact_factor_year: metric.as_ref().map(|item| item.data_year),
                    impact_factor_source: metric.as_ref().map(|item| item.source.clone()),
                    impact_factor_url: metric.as_ref().map(|item| item.source_url.clone()),
                    excerpt: source.excerpt.clone(),
                    locator: format!(
                        "abstract · {} · {}",
                        source.year.as_deref().unwrap_or("年份未知"),
                        source.sources.join(" / ")
                    ),
                    evidence_type: item.evidence_type,
                    confidence: item.confidence,
                    supports: vec![item.support],
                });
            }
            on_trace(LiveResearchTrace::EvidenceExtractionProgress {
                extracted_count: evidence.len(),
                total_count: selected.len(),
            });
        }
        Ok(evidence)
    }

    fn extract_evidence_subset(
        &self,
        brief: &ResearchBrief,
        papers: &[SourcePaper],
        batch: &[&RankedPaper],
    ) -> Result<Vec<ExtractedEvidence>, LiveResearchError> {
        let mut pending = (0..batch.len()).collect::<Vec<_>>();
        let mut completed = HashMap::<usize, ExtractedEvidence>::new();
        for _ in 0..MAX_EVIDENCE_ATTEMPTS {
            if pending.is_empty() {
                break;
            }
            let requested = pending.clone();
            let value = match self.complete_json(
                "你是严谨的生物医学证据抽取器。必须逐篇解读输入摘要，每个 source_index 恰好返回一条；只使用输入摘要，不得补写事实；只输出一个包含 items 数组的 JSON 对象。",
                json!({
                    "task": "从已达到相关性阈值的真实文献摘要中逐篇抽取证据。",
                    "research_brief": brief,
                    "sources": requested.iter().enumerate().map(|(local_index, batch_index)| {
                        let ranked = batch[*batch_index];
                        let paper = &papers[ranked.source_index];
                        json!({
                            "source_index": local_index,
                            "title": paper.title,
                            "authors": paper.authors,
                            "excerpt": paper.excerpt,
                            "year": paper.year,
                            "databases": paper.sources,
                            "relevance_score": ranked.score,
                            "relevance_reason": ranked.reason,
                        })
                    }).collect::<Vec<_>>(),
                    "output_schema": {
                        "items": [{
                            "source_index": 0,
                            "support": "该摘要直接支持的简短结论",
                            "genes": ["摘要或标题中明确出现的标准基因/蛋白符号；没有则返回空数组"],
                            "findings": ["摘要明确报告的关键研究结果；最多3项"],
                            "evidence_type": "study design or evidence type",
                            "confidence": 0.8
                        }]
                    }
                }),
            ) {
                Ok(value) => value,
                Err(
                    LiveResearchError::InvalidJson
                    | LiveResearchError::Model
                    | LiveResearchError::ModelRateLimited,
                ) => break,
                Err(error) => return Err(error),
            };
            let extracted: EvidenceExtractionPayload = match serde_json::from_value(value) {
                Ok(payload) => payload,
                Err(_) => continue,
            };
            let mut seen_local = std::collections::HashSet::new();
            for item in extracted.into_items() {
                let Some(local_index) = parse_usize_value(&item.source_index) else {
                    continue;
                };
                if local_index >= requested.len() || !seen_local.insert(local_index) {
                    continue;
                }
                let Some(support) = item
                    .support
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                else {
                    continue;
                };
                let support = support.to_owned();
                let batch_index = requested[local_index];
                let ranked = batch[batch_index];
                let source = &papers[ranked.source_index];
                let mut findings = normalize_entity_values(item.findings, 3);
                if findings.is_empty() {
                    findings.push(support.clone());
                }
                completed.insert(
                    batch_index,
                    ExtractedEvidence {
                        batch_index,
                        support,
                        genes: grounded_gene_values(item.genes, source),
                        findings,
                        evidence_type: item
                            .evidence_type
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .unwrap_or("unspecified")
                            .to_owned(),
                        confidence: parse_confidence_value(&item.confidence).unwrap_or(0.5),
                    },
                );
            }
            pending.retain(|batch_index| !completed.contains_key(batch_index));
        }
        for batch_index in pending {
            let ranked = batch[batch_index];
            completed.insert(
                batch_index,
                ExtractedEvidence {
                    batch_index,
                    support: format!("模型已依据该论文摘要完成相关性解读：{}", ranked.reason),
                    genes: vec![],
                    findings: vec![format!(
                        "模型已依据该论文摘要完成相关性解读：{}",
                        ranked.reason
                    )],
                    evidence_type: "abstract relevance assessment".into(),
                    confidence: (ranked.score / 20.0).clamp(0.0, 1.0),
                },
            );
        }
        Ok((0..batch.len())
            .filter_map(|batch_index| completed.remove(&batch_index))
            .collect())
    }
}

impl LiveResearchBackend for OpenAiResearchBackend {
    fn collect_evidence(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        self.collect_evidence_internal(run_id, brief, &mut |_| {})
    }

    fn collect_evidence_with_trace(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
        on_trace: &mut dyn FnMut(LiveResearchTrace),
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        self.collect_evidence_internal(run_id, brief, on_trace)
    }

    fn search_public_datasets(&self, brief: &ResearchBrief) -> Vec<PublicDataset> {
        public_datasets::search_public_datasets(&self.agent, brief)
    }

    fn synthesize_report(
        &self,
        run_id: &str,
        version: u32,
        brief: &ResearchBrief,
        evidence: &[EvidenceRecord],
        revision_request: Option<&str>,
    ) -> Result<Report, LiveResearchError> {
        let (date_from, date_to) = effective_date_range(brief);
        let allowed_ids = evidence
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();
        let compact_evidence = evidence
            .iter()
            .map(|item| {
                json!({
                    "id": item.id,
                    "paper_id": item.paper_id,
                    "paper_title": item.paper_title,
                    "authors": item.authors,
                    "genes": item.genes,
                    "findings": item.findings,
                    "excerpt": truncate_chars(&item.excerpt, MAX_REPORT_EVIDENCE_CHARS),
                    "locator": item.locator,
                    "evidence_type": item.evidence_type,
                    "confidence": item.confidence,
                    "supports": item.supports,
                })
            })
            .collect::<Vec<_>>();
        let payload = json!({
            "task": if revision_request.is_some() { "根据新增约束修订完整研究报告" } else { "生成完整研究报告" },
            "research_brief": brief,
            "revision_request": revision_request,
            "allowed_evidence_ids": allowed_ids,
            "evidence": compact_evidence,
            "active_conclusion_skills": ACTIVE_CONCLUSION_SKILLS,
            "requirements": {
                "claim_evidence_coverage": "100%",
                "recommendation_count": 3,
                "language": "zh-CN",
                "do_not_invent_sources": true,
                "major_claims": {
                    "synthesis_unit": "围绕生物学机制或过程跨论文综合，不得逐篇复述",
                    "statement_structure": "证据中观察到的共同模式 → 对细胞状态、基因/蛋白、通路或表型的生物学解释 → 证据边界或替代解释",
                    "concrete_entities": "优先写出 Evidence Record 中明确出现的细胞类型、基因/蛋白、通路、干预和表型；不得补充输入中没有的实体",
                    "evidence_convergence": "存在多个 Evidence Record 时优先整合至少两个相互独立证据；不要因证据数量多就自动声称因果或机制已证实",
                    "claim_calibration": "区分描述性、关联性、预测性、因果性和机制性结论；观察性或摘要级证据使用提示、关联、一致等审慎措辞",
                    "avoid_generic_statements": [
                        "某技术揭示了异质性",
                        "某细胞发挥重要作用",
                        "某治疗显示潜力"
                    ],
                    "length": "每条主要结论使用信息密集的 1 至 2 句中文，通常 70 至 180 个汉字"
                },
                "timeline": {
                    "publication_year_from": date_from,
                    "publication_year_to": date_to,
                    "order": "ascending",
                    "content": "按论文发表年份归纳该年关键文献取得的具体成果；合并同年成果；同一年有多篇文献时，每篇成果使用换行符分隔，禁止用分号串联不同文献；不得生成没有 Evidence Record 支持的年份或成果；每项以 YYYY：开头"
                },
                "disclaimer": "本报告仅供科研用途，不构成临床诊断或治疗建议。"
            },
            "output_schema": report_output_schema()
        });
        let system_prompt = report_system_prompt();
        let mut last_error = LiveResearchError::InvalidReportResponse;
        for _ in 0..MAX_MODEL_REQUEST_ATTEMPTS {
            let value = self.complete_json(&system_prompt, payload.clone())?;
            let draft: ReportDraft = match serde_json::from_value(value) {
                Ok(draft) => draft,
                Err(_) => {
                    last_error = LiveResearchError::InvalidReportResponse;
                    continue;
                }
            };
            let report = draft.into_report(run_id, version, evidence.to_vec());
            match validate_report(&report) {
                Ok(()) => return Ok(report),
                Err(error) if error.contains("outside") => {
                    last_error = LiveResearchError::UnknownEvidence;
                }
                Err(_) => {
                    last_error = LiveResearchError::CitationAudit;
                }
            }
        }
        Err(last_error)
    }

    fn grounded_reply(
        &self,
        question: &str,
        report: &Report,
        history: &[ConversationMessage],
    ) -> Result<GroundedReply, LiveResearchError> {
        let allowed_ids = report
            .evidence
            .iter()
            .map(|item| item.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let value = self.complete_json(
            "你是 PaperPilot 报告追问助手。仅依据输入 Evidence Record 回答；结合 conversation_history 理解上下文；只回答当前问题新增的部分，不得复述历史回答或整段报告摘要；无法回答时明确说明证据不足；只输出 JSON。",
            json!({
                "question": question,
                "conversation_history": history.iter().map(|message| json!({
                    "role": message.role,
                    "content": message.content,
                })).collect::<Vec<_>>(),
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

fn report_system_prompt() -> String {
    format!(
        "你是 PaperPilot 生物医学研究综合器。只能引用 allowed_evidence_ids；必须输出严格 JSON；不得使用模型记忆补充未提供的研究结果；timeline 必须按发表年份升序呈现文献成果演进，默认从 2010 年到当前最新年份；建议必须恰好三个。\n\n{}\n\n执行边界：这些技能只用于改进证据综合和结论表达，不能绕过 Evidence Record、凭常识补写机制或把候选解释写成已证实事实。主要结论必须先说明证据观察，再给出有边界的生物学解释；若输入不足以支持机制，只写关联并明确需要何种验证。",
        conclusion_skill_guidance()
    )
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
    #[serde(default, rename = "hitCount")]
    _hit_count: usize,
    next_cursor_mark: Option<String>,
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
    journal_title: Option<String>,
    journal_issn: Option<String>,
    author_string: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PubMedSearchResponse {
    esearchresult: PubMedSearchResult,
}

#[derive(Debug, Deserialize)]
struct PubMedSearchResult {
    count: String,
    idlist: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAlexResponse {
    meta: OpenAlexMeta,
    results: Vec<OpenAlexWork>,
}

#[derive(Debug, Deserialize)]
struct OpenAlexMeta {
    #[serde(rename = "count")]
    _count: usize,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAlexWork {
    id: String,
    doi: Option<String>,
    title: Option<String>,
    publication_year: Option<u32>,
    #[serde(default)]
    ids: OpenAlexIds,
    primary_location: Option<OpenAlexLocation>,
    abstract_inverted_index: Option<HashMap<String, Vec<usize>>>,
    #[serde(default)]
    authorships: Vec<OpenAlexAuthorship>,
}

#[derive(Debug, Deserialize)]
struct OpenAlexAuthorship {
    author: Option<OpenAlexAuthor>,
}

#[derive(Debug, Deserialize)]
struct OpenAlexAuthor {
    display_name: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct OpenAlexIds {
    doi: Option<String>,
    pmid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAlexLocation {
    source: Option<OpenAlexSource>,
}

#[derive(Debug, Deserialize)]
struct OpenAlexSource {
    display_name: Option<String>,
    issn_l: Option<String>,
    issn: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct CrossrefResponse {
    message: CrossrefMessage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct CrossrefMessage {
    #[serde(rename = "total-results")]
    _total_results: usize,
    next_cursor: Option<String>,
    items: Vec<CrossrefWork>,
}

#[derive(Debug, Deserialize)]
struct CrossrefWork {
    #[serde(rename = "DOI")]
    doi: Option<String>,
    #[serde(default)]
    title: Vec<String>,
    r#abstract: Option<String>,
    published: Option<CrossrefPublished>,
    #[serde(default, rename = "container-title")]
    container_title: Vec<String>,
    #[serde(default, rename = "ISSN")]
    issn: Vec<String>,
    #[serde(default)]
    author: Vec<CrossrefAuthor>,
}

#[derive(Debug, Deserialize)]
struct CrossrefAuthor {
    given: Option<String>,
    family: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CrossrefPublished {
    #[serde(rename = "date-parts")]
    date_parts: Vec<Vec<u32>>,
}

#[derive(Clone)]
struct SourcePaper {
    paper_id: String,
    title: String,
    authors: Vec<String>,
    excerpt: String,
    year: Option<String>,
    journal: Option<String>,
    issn: Option<String>,
    sources: Vec<String>,
}

struct RankedPaper {
    source_index: usize,
    score: f32,
    reason: String,
}

struct ExtractedEvidence {
    batch_index: usize,
    support: String,
    genes: Vec<String>,
    findings: Vec<String>,
    evidence_type: String,
    confidence: f32,
}

struct SearchResults {
    matched_count: usize,
    batch_count: usize,
    returned_count: usize,
    usable_count: usize,
    reached_limit: bool,
    papers: Vec<SourcePaper>,
}

impl SourcePaper {
    fn from_europe_pmc(result: EuropePmcResult) -> Option<Self> {
        let title = result.title?.trim().to_owned();
        let excerpt = truncate_chars(result.abstract_text?.trim(), MAX_EXCERPT_CHARS);
        if title.is_empty() || excerpt.is_empty() {
            return None;
        }
        let paper_id = result
            .pmid
            .map(|value| format!("pmid:{}", value.trim()))
            .or_else(|| {
                result
                    .pmcid
                    .map(|value| format!("pmcid:{}", value.trim().to_uppercase()))
            })
            .or_else(|| {
                result
                    .doi
                    .map(|value| format!("doi:{}", normalize_doi(value)))
            })
            .or_else(|| result.id.map(|value| format!("europepmc:{value}")))?;
        Some(Self {
            paper_id,
            title,
            authors: split_author_string(result.author_string.as_deref()),
            excerpt,
            year: result.pub_year,
            journal: result.journal_title,
            issn: result.journal_issn,
            sources: vec![EUROPE_PMC.into()],
        })
    }

    fn from_openalex(work: OpenAlexWork) -> Option<Self> {
        let title = work.title?.trim().to_owned();
        let excerpt = reconstruct_openalex_abstract(work.abstract_inverted_index?)?;
        if title.is_empty() || excerpt.is_empty() {
            return None;
        }
        let doi = work.doi.or(work.ids.doi).map(normalize_doi);
        let pmid = work.ids.pmid.and_then(last_url_segment);
        let paper_id = pmid
            .map(|value| format!("pmid:{value}"))
            .or_else(|| doi.map(|value| format!("doi:{value}")))
            .unwrap_or_else(|| {
                format!("openalex:{}", last_url_segment(work.id).unwrap_or_default())
            });
        let (journal, issn) = work
            .primary_location
            .and_then(|location| location.source)
            .map(|source| {
                (
                    source.display_name,
                    source
                        .issn_l
                        .or_else(|| source.issn.into_iter().flatten().next()),
                )
            })
            .unwrap_or_default();
        let authors = normalize_entity_values(
            work.authorships
                .into_iter()
                .filter_map(|authorship| authorship.author?.display_name)
                .collect(),
            50,
        );
        Some(Self {
            paper_id,
            title,
            authors,
            excerpt,
            year: work.publication_year.map(|year| year.to_string()),
            journal,
            issn,
            sources: vec![OPENALEX.into()],
        })
    }

    fn from_crossref(work: CrossrefWork) -> Option<Self> {
        let title = work.title.into_iter().next()?.trim().to_owned();
        let excerpt = truncate_chars(&strip_markup(work.r#abstract?.trim()), MAX_EXCERPT_CHARS);
        if title.is_empty() || excerpt.is_empty() {
            return None;
        }
        let paper_id = format!("doi:{}", normalize_doi(work.doi?));
        let year = work
            .published
            .and_then(|published| published.date_parts.into_iter().next())
            .and_then(|parts| parts.into_iter().next())
            .map(|year| year.to_string());
        Some(Self {
            paper_id,
            title,
            authors: normalize_entity_values(
                work.author
                    .into_iter()
                    .filter_map(|author| {
                        author.name.or_else(|| {
                            let value = [author.given, author.family]
                                .into_iter()
                                .flatten()
                                .collect::<Vec<_>>()
                                .join(" ");
                            (!value.trim().is_empty()).then_some(value)
                        })
                    })
                    .collect(),
                50,
            ),
            excerpt,
            year,
            journal: work.container_title.into_iter().next(),
            issn: work.issn.into_iter().next(),
            sources: vec![CROSSREF.into()],
        })
    }
}

impl SearchResults {
    fn new(
        matched_count: usize,
        batch_count: usize,
        returned_count: usize,
        papers: Vec<SourcePaper>,
    ) -> Self {
        let usable_count = papers.len();
        Self {
            matched_count,
            batch_count,
            returned_count,
            usable_count,
            reached_limit: false,
            papers: merge_duplicate_papers(papers),
        }
    }
}

#[derive(Default)]
struct PubMedPaperBuilder {
    pmid: String,
    doi: String,
    title: String,
    authors: Vec<String>,
    author_given: String,
    author_family: String,
    collective_author: String,
    abstract_text: String,
    year: String,
    journal: String,
    issn: String,
}

impl PubMedPaperBuilder {
    fn finish(self) -> Option<SourcePaper> {
        let title = self.title.trim().to_owned();
        let excerpt = truncate_chars(self.abstract_text.trim(), MAX_EXCERPT_CHARS);
        if title.is_empty() || excerpt.is_empty() {
            return None;
        }
        let paper_id = if !self.pmid.trim().is_empty() {
            format!("pmid:{}", self.pmid.trim())
        } else if !self.doi.trim().is_empty() {
            format!("doi:{}", normalize_doi(self.doi))
        } else {
            return None;
        };
        Some(SourcePaper {
            paper_id,
            title,
            authors: normalize_entity_values(self.authors, 50),
            excerpt,
            year: (!self.year.trim().is_empty()).then(|| self.year.trim().to_owned()),
            journal: (!self.journal.trim().is_empty()).then(|| self.journal.trim().to_owned()),
            issn: (!self.issn.trim().is_empty()).then(|| self.issn.trim().to_owned()),
            sources: vec![PUBMED.into()],
        })
    }
}

#[derive(Clone, Copy)]
enum PubMedField {
    Pmid,
    Doi,
    Title,
    AuthorGiven,
    AuthorFamily,
    CollectiveAuthor,
    Abstract,
    Year,
    Journal,
    Issn,
}

fn parse_pubmed_xml(xml: &str) -> Result<Vec<SourcePaper>, SourceSearchError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut current = None::<PubMedPaperBuilder>;
    let mut field = None::<PubMedField>;
    let mut papers = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = event.name();
                match name.as_ref() {
                    b"PubmedArticle" => current = Some(PubMedPaperBuilder::default()),
                    b"PMID" if current.is_some() => field = Some(PubMedField::Pmid),
                    b"ArticleTitle" if current.is_some() => field = Some(PubMedField::Title),
                    b"ForeName" if current.is_some() => field = Some(PubMedField::AuthorGiven),
                    b"LastName" if current.is_some() => field = Some(PubMedField::AuthorFamily),
                    b"CollectiveName" if current.is_some() => {
                        field = Some(PubMedField::CollectiveAuthor)
                    }
                    b"AbstractText" if current.is_some() => {
                        if let Some(builder) = current.as_mut()
                            && !builder.abstract_text.is_empty()
                        {
                            builder.abstract_text.push(' ');
                        }
                        field = Some(PubMedField::Abstract);
                    }
                    b"Year" if current.is_some() => field = Some(PubMedField::Year),
                    b"Title" if current.is_some() => field = Some(PubMedField::Journal),
                    b"ISSN" if current.is_some() => field = Some(PubMedField::Issn),
                    b"ArticleId" if current.is_some() => {
                        let is_doi = event.attributes().flatten().any(|attribute| {
                            attribute.key.as_ref() == b"IdType"
                                && attribute
                                    .decoded_and_normalized_value(
                                        XmlVersion::Implicit1_0,
                                        reader.decoder(),
                                    )
                                    .is_ok_and(|value| value.eq_ignore_ascii_case("doi"))
                        });
                        field = is_doi.then_some(PubMedField::Doi);
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(text)) => {
                if let (Some(builder), Some(active)) = (current.as_mut(), field)
                    && let Some(value) = decode_xml_text(&text)
                {
                    match active {
                        PubMedField::Pmid if builder.pmid.is_empty() => {
                            builder.pmid.push_str(&value)
                        }
                        PubMedField::Doi => builder.doi.push_str(&value),
                        PubMedField::Title => builder.title.push_str(&value),
                        PubMedField::AuthorGiven => builder.author_given.push_str(&value),
                        PubMedField::AuthorFamily => builder.author_family.push_str(&value),
                        PubMedField::CollectiveAuthor => builder.collective_author.push_str(&value),
                        PubMedField::Abstract => builder.abstract_text.push_str(&value),
                        PubMedField::Year if builder.year.is_empty() => {
                            builder.year.push_str(&value)
                        }
                        PubMedField::Journal if builder.journal.is_empty() => {
                            builder.journal.push_str(&value)
                        }
                        PubMedField::Issn if builder.issn.is_empty() => {
                            builder.issn.push_str(&value)
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"Author" => {
                    if let Some(builder) = current.as_mut() {
                        let author = if !builder.collective_author.trim().is_empty() {
                            builder.collective_author.trim().to_owned()
                        } else {
                            format!(
                                "{} {}",
                                builder.author_given.trim(),
                                builder.author_family.trim()
                            )
                            .trim()
                            .to_owned()
                        };
                        if !author.is_empty() {
                            builder.authors.push(author);
                        }
                        builder.author_given.clear();
                        builder.author_family.clear();
                        builder.collective_author.clear();
                    }
                    field = None;
                }
                b"PubmedArticle" => {
                    if let Some(paper) = current.take().and_then(PubMedPaperBuilder::finish) {
                        papers.push(paper);
                    }
                    field = None;
                }
                b"PMID" | b"ArticleTitle" | b"ForeName" | b"LastName" | b"CollectiveName"
                | b"AbstractText" | b"Year" | b"Title" | b"ISSN" | b"ArticleId" => {
                    field = None;
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => return Err(SourceSearchError::InvalidResponse),
            _ => {}
        }
    }
    Ok(papers)
}

fn decode_xml_text(text: &quick_xml::events::BytesText<'_>) -> Option<String> {
    let decoded = text.decode().ok()?;
    quick_xml::escape::unescape(&decoded)
        .ok()
        .map(|value| value.into_owned())
}

fn reconstruct_openalex_abstract(index: HashMap<String, Vec<usize>>) -> Option<String> {
    let mut tokens = index
        .into_iter()
        .flat_map(|(word, positions)| {
            positions
                .into_iter()
                .filter(|position| *position < 10_000)
                .map(move |position| (position, word.clone()))
        })
        .collect::<Vec<_>>();
    tokens.sort_by_key(|(position, _)| *position);
    let value = truncate_chars(
        &tokens
            .into_iter()
            .map(|(_, word)| word)
            .collect::<Vec<_>>()
            .join(" "),
        MAX_EXCERPT_CHARS,
    );
    (!value.is_empty()).then_some(value)
}

fn strip_markup(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn source_paper_abstract_contains_query_keyword(paper: &SourcePaper, query: &str) -> bool {
    text_contains_any_query_keyword(&paper.excerpt, query)
}

fn text_contains_any_query_keyword(text: &str, query: &str) -> bool {
    let searchable = normalize_search_text(text);
    let groups = boolean_query_groups(query);
    !searchable.is_empty()
        && !groups.is_empty()
        && groups.iter().any(|alternatives| {
            alternatives.iter().any(|term| {
                let normalized = normalize_search_text(term);
                !normalized.is_empty() && search_text_contains(&searchable, &normalized)
            })
        })
}

fn boolean_query_groups(query: &str) -> Vec<Vec<String>> {
    split_boolean_query(strip_outer_parentheses(query), "AND")
        .into_iter()
        .map(|group| {
            split_boolean_query(strip_outer_parentheses(group), "OR")
                .into_iter()
                .map(strip_outer_parentheses)
                .map(|term| term.trim().trim_matches('"').trim().to_owned())
                .filter(|term| !term.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|group| !group.is_empty())
        .collect()
}

fn split_boolean_query<'a>(query: &'a str, operator: &str) -> Vec<&'a str> {
    let bytes = query.as_bytes();
    let operator_bytes = operator.as_bytes();
    let mut parts = Vec::new();
    let mut start = 0;
    let mut depth = 0_u32;
    let mut quoted = false;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => quoted = !quoted,
            b'(' if !quoted => depth += 1,
            b')' if !quoted => depth = depth.saturating_sub(1),
            _ => {}
        }
        let end = index + operator_bytes.len();
        if !quoted
            && depth == 0
            && end <= bytes.len()
            && bytes[index..end].eq_ignore_ascii_case(operator_bytes)
            && is_boolean_boundary(bytes.get(index.wrapping_sub(1)).copied())
            && is_boolean_boundary(bytes.get(end).copied())
        {
            parts.push(query[start..index].trim());
            start = end;
            index = end;
            continue;
        }
        index += 1;
    }
    parts.push(query[start..].trim());
    parts
}

fn is_boolean_boundary(character: Option<u8>) -> bool {
    character.is_none_or(|character| character.is_ascii_whitespace() || b"()".contains(&character))
}

fn strip_outer_parentheses(mut value: &str) -> &str {
    loop {
        let trimmed = value.trim();
        if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
            return trimmed;
        }
        let mut depth = 0_i32;
        let mut quoted = false;
        let mut closes_at_end = false;
        for (index, character) in trimmed.char_indices() {
            match character {
                '"' => quoted = !quoted,
                '(' if !quoted => depth += 1,
                ')' if !quoted => {
                    depth -= 1;
                    if depth == 0 {
                        closes_at_end = index + character.len_utf8() == trimmed.len();
                        break;
                    }
                }
                _ => {}
            }
        }
        if !closes_at_end {
            return trimmed;
        }
        value = &trimmed[1..trimmed.len() - 1];
    }
}

fn normalize_search_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_text_contains(searchable: &str, term: &str) -> bool {
    searchable == term
        || searchable.starts_with(&format!("{term} "))
        || searchable.ends_with(&format!(" {term}"))
        || searchable.contains(&format!(" {term} "))
}

fn normalize_doi(value: String) -> String {
    value
        .trim()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .to_lowercase()
}

fn effective_date_range(brief: &ResearchBrief) -> (u16, u16) {
    let current_year = Utc::now().year().clamp(1900, 2100) as u16;
    let from = brief.date_from.unwrap_or(2010).clamp(1900, current_year);
    let to = brief
        .date_to
        .unwrap_or(current_year)
        .clamp(from, current_year);
    (from, to)
}

fn last_url_segment(value: String) -> Option<String> {
    value
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn google_scholar_search_url(query: &str, date_from: u16, date_to: u16) -> String {
    format!(
        "https://scholar.google.com/scholar?q={}&as_ylo={date_from}&as_yhi={date_to}",
        percent_encode_query(query)
    )
}

fn percent_encode_query(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}

fn record_source_result(
    source: &str,
    result: Result<SearchResults, SourceSearchError>,
    successful_sources: &mut usize,
    collected: &mut Vec<SourcePaper>,
    on_trace: &mut dyn FnMut(LiveResearchTrace),
) {
    match result {
        Ok(result) => {
            *successful_sources += 1;
            let unique_count = result.papers.len();
            on_trace(LiveResearchTrace::SourcesRetrieved {
                source: source.into(),
                matched_count: result.matched_count,
                batch_count: result.batch_count,
                returned_count: result.returned_count,
                usable_count: result.usable_count,
                unique_count,
                reached_limit: result.reached_limit,
            });
            collected.extend(result.papers);
        }
        Err(error) => on_trace(LiveResearchTrace::SourceRetrievalFailed {
            source: source.into(),
            reason: error.to_string(),
        }),
    }
}

fn merge_duplicate_papers(papers: Vec<SourcePaper>) -> Vec<SourcePaper> {
    let mut merged = Vec::<SourcePaper>::new();
    let mut by_id = HashMap::<String, usize>::new();
    let mut by_title = HashMap::<String, usize>::new();
    for paper in papers {
        let id = paper.paper_id.to_lowercase();
        let title = normalize_title(&paper.title);
        let existing = by_id
            .get(&id)
            .copied()
            .or_else(|| by_title.get(&title).copied());
        if let Some(index) = existing {
            let current = &mut merged[index];
            current.authors = normalize_entity_values(
                current
                    .authors
                    .iter()
                    .chain(paper.authors.iter())
                    .cloned()
                    .collect(),
                50,
            );
            for source in paper.sources {
                if !current.sources.contains(&source) {
                    current.sources.push(source);
                }
            }
            if paper.excerpt.chars().count() > current.excerpt.chars().count() {
                current.excerpt = paper.excerpt;
            }
            if current.journal.is_none() {
                current.journal = paper.journal;
            }
            if current.issn.is_none() {
                current.issn = paper.issn;
            }
            by_id.insert(id, index);
            by_title.insert(title, index);
        } else {
            let index = merged.len();
            by_id.insert(id, index);
            by_title.insert(title, index);
            merged.push(paper);
        }
    }
    merged
}

fn normalize_title(title: &str) -> String {
    title
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn normalize_entity_values(values: Vec<String>, limit: usize) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for value in values {
        let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
        if value.is_empty() || value.chars().count() > 160 {
            continue;
        }
        let key = value.to_lowercase();
        if seen.insert(key) {
            normalized.push(value);
        }
        if normalized.len() >= limit {
            break;
        }
    }
    normalized
}

fn split_author_string(value: Option<&str>) -> Vec<String> {
    normalize_entity_values(
        value
            .unwrap_or_default()
            .split([',', ';'])
            .map(str::trim)
            .filter(|author| !author.is_empty())
            .map(str::to_owned)
            .collect(),
        50,
    )
}

fn grounded_gene_values(values: Vec<String>, paper: &SourcePaper) -> Vec<String> {
    let searchable = format!("{} {}", paper.title, paper.excerpt).to_lowercase();
    normalize_entity_values(values, 24)
        .into_iter()
        .filter(|gene| searchable.contains(&gene.to_lowercase()))
        .collect()
}

fn ranked_source(ranked: &RankedPaper, paper: &SourcePaper) -> RankedSource {
    RankedSource {
        source: paper.sources.join(" / "),
        title: paper.title.clone(),
        year: paper.year.clone().unwrap_or_else(|| "年份未知".into()),
        score: ranked.score.round().clamp(0.0, 20.0) as u8,
        reason: ranked.reason.clone(),
        included: ranked.score >= MIN_RELEVANCE_SCORE,
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum EvidenceExtractionPayload {
    Wrapped(EvidenceExtraction),
    Items(Vec<EvidenceItem>),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RankingPayload {
    Wrapped(RankingItems),
    Items(Vec<RankingItem>),
}

impl RankingPayload {
    fn into_items(self) -> Vec<RankingItem> {
        match self {
            Self::Wrapped(payload) => payload.items,
            Self::Items(items) => items,
        }
    }
}

#[derive(Debug, Deserialize)]
struct RankingItems {
    #[serde(alias = "scores", alias = "rankings", alias = "results")]
    items: Vec<RankingItem>,
}

#[derive(Debug, Deserialize)]
struct RankingItem {
    #[serde(alias = "sourceIndex")]
    source_index: Value,
    #[serde(alias = "relevanceScore", alias = "score")]
    relevance_score: Value,
    #[serde(default, alias = "rationale", alias = "explanation")]
    reason: Option<String>,
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
        alias = "evidenceRecords",
        alias = "results"
    )]
    items: Vec<EvidenceItem>,
}

#[derive(Debug, Deserialize)]
struct EvidenceItem {
    #[serde(alias = "sourceIndex")]
    source_index: Value,
    #[serde(alias = "supports", alias = "claim", alias = "conclusion")]
    support: Option<String>,
    #[serde(default, alias = "geneSymbols", alias = "gene_symbols")]
    genes: Vec<String>,
    #[serde(
        default,
        alias = "results",
        alias = "keyFindings",
        alias = "key_findings"
    )]
    findings: Vec<String>,
    #[serde(alias = "evidenceType", alias = "type")]
    evidence_type: Option<String>,
    #[serde(default)]
    confidence: Value,
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
            schema_version: "1.1".into(),
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
            related_datasets: Vec::new(),
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
        "timeline": ["2010：基于当年 Evidence Record 归纳的具体文献成果", "2026：最新文献成果"],
        "themes": ["主题"],
        "claims": [{
            "id": "claim-1",
            "statement": "跨论文证据观察 → 涉及具体细胞、基因/蛋白、通路或表型的生物学解释 → 证据边界或替代解释",
            "evidenceIds": ["allowed id"]
        }],
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

fn parse_search_query_value(value: &Value) -> Result<String, LiveResearchError> {
    let mut candidates = Vec::<(u16, String)>::new();
    collect_search_query_candidates(value, None, &mut candidates);
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    candidates
        .into_iter()
        .filter(|(score, _)| *score >= 30)
        .filter_map(|(_, candidate)| normalize_search_query_candidate(&candidate))
        .next()
        .ok_or(LiveResearchError::InvalidSearchQuery)
}

fn collect_search_query_candidates(
    value: &Value,
    parent_key: Option<&str>,
    candidates: &mut Vec<(u16, String)>,
) {
    let key = parent_key.unwrap_or_default().to_ascii_lowercase();
    let key_score = if key.contains("query") || key.contains("boolean") {
        100
    } else if key.contains("search") || key.contains("expression") {
        70
    } else if key.contains("term") || key.contains("concept") {
        30
    } else {
        0
    };
    match value {
        Value::String(candidate) => {
            let upper = candidate.to_ascii_uppercase();
            let syntax_score = u16::from(upper.contains(" AND ")) * 30
                + u16::from(upper.contains(" OR ")) * 15
                + u16::from(candidate.contains('(') || candidate.contains(')')) * 10;
            candidates.push((key_score + syntax_score, candidate.clone()));
        }
        Value::Array(items) => {
            let terms = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|term| !term.is_empty())
                .collect::<Vec<_>>();
            if terms.len() > 1 {
                candidates.push((key_score + 25, terms.join(" AND ")));
            }
            if key.contains("concept") || key.contains("group") {
                let groups = items
                    .iter()
                    .map(|item| {
                        let mut terms = Vec::new();
                        collect_string_leaves(item, &mut terms);
                        terms.sort();
                        terms.dedup();
                        terms
                    })
                    .filter(|terms| !terms.is_empty())
                    .map(|terms| format!("({})", terms.join(" OR ")))
                    .collect::<Vec<_>>();
                if groups.len() > 1 {
                    candidates.push((key_score + 60, groups.join(" AND ")));
                }
            }
            for item in items {
                collect_search_query_candidates(item, parent_key, candidates);
            }
        }
        Value::Object(object) => {
            for (child_key, child) in object {
                collect_search_query_candidates(child, Some(child_key), candidates);
            }
        }
        _ => {}
    }
}

fn collect_string_leaves(value: &Value, strings: &mut Vec<String>) {
    match value {
        Value::String(value) if !value.trim().is_empty() => strings.push(value.trim().to_owned()),
        Value::Array(items) => {
            for item in items {
                collect_string_leaves(item, strings);
            }
        }
        Value::Object(object) => {
            for value in object.values() {
                collect_string_leaves(value, strings);
            }
        }
        _ => {}
    }
}

fn normalize_search_query_candidate(candidate: &str) -> Option<String> {
    let query = candidate
        .trim()
        .trim_matches('`')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!query.is_empty() && query.chars().count() <= 500 && !boolean_query_groups(&query).is_empty())
        .then_some(query)
}

fn fallback_search_query(brief: &ResearchBrief) -> Result<String, LiveResearchError> {
    let terms = brief
        .keywords
        .iter()
        .map(String::as_str)
        .chain(brief.population.as_deref())
        .chain(brief.intervention.as_deref())
        .map(str::trim)
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect::<Vec<_>>();
    let candidate = if terms.is_empty() {
        brief.question.trim().to_owned()
    } else {
        terms.join(" AND ")
    };
    normalize_search_query_candidate(&candidate).ok_or(LiveResearchError::InvalidSearchQuery)
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

fn parse_usize_value(value: &Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .or_else(|| value.as_str()?.trim().parse().ok())
}

fn parse_score_value(value: &Value) -> Option<f32> {
    let score = value.as_f64().map(|value| value as f32).or_else(|| {
        value
            .as_str()?
            .trim()
            .split('/')
            .next()?
            .trim()
            .trim_end_matches('分')
            .trim()
            .parse()
            .ok()
    })?;
    score.is_finite().then_some(score)
}

fn parse_confidence_value(value: &Value) -> Option<f32> {
    let confidence = value.as_f64().map(|value| value as f32).or_else(|| {
        let raw = value.as_str()?.trim();
        if let Some(percent) = raw.strip_suffix('%') {
            percent
                .trim()
                .parse::<f32>()
                .ok()
                .map(|value| value / 100.0)
        } else {
            raw.parse().ok()
        }
    })?;
    confidence.is_finite().then(|| confidence.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        CROSSREF, CROSSREF_MAX_SEARCH_RESULTS, CROSSREF_PAGE_SIZE, CrossrefAuthor,
        CrossrefResponse, CrossrefWork, EUROPE_PMC, EUROPE_PMC_PAGE_SIZE, EuropePmcResponse,
        LiveResearchError, OPENALEX_PAGE_SIZE, OpenAlexResponse, PUBMED, SourcePaper,
        boolean_query_groups, classify_model_error, fallback_search_query,
        google_scholar_search_url, merge_duplicate_papers, parse_confidence_value,
        parse_json_content, parse_pubmed_xml, parse_score_value, parse_search_query_value,
        parse_usize_value, reconstruct_openalex_abstract, report_system_prompt,
        source_paper_abstract_contains_query_keyword, truncate_chars,
    };
    use serde_json::json;

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
    fn report_synthesis_activates_local_conclusion_skills() {
        let prompt = report_system_prompt();
        assert!(prompt.contains("literature-review"));
        assert!(prompt.contains("scientific-critical-thinking"));
        assert!(prompt.contains("hypothesis-generation"));
        assert!(prompt.contains("不能绕过 Evidence Record"));
        assert!(prompt.contains("生物学解释"));
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

    #[test]
    fn accepts_common_model_index_and_score_encodings() {
        assert_eq!(parse_usize_value(&json!(3)), Some(3));
        assert_eq!(parse_usize_value(&json!("4")), Some(4));
        assert_eq!(parse_score_value(&json!(15)), Some(15.0));
        assert_eq!(parse_score_value(&json!("12/20")), Some(12.0));
        assert_eq!(parse_score_value(&json!("7 分")), Some(7.0));
        assert_eq!(parse_score_value(&json!("high")), None);
        assert_eq!(parse_confidence_value(&json!("80%")), Some(0.8));
        assert_eq!(parse_confidence_value(&json!("0.9")), Some(0.9));
    }

    #[test]
    fn parses_pubmed_xml_into_traceable_papers() {
        let papers = parse_pubmed_xml(
            r#"<PubmedArticleSet><PubmedArticle><MedlineCitation>
                <PMID>12345</PMID><Article><ArticleTitle>A useful paper</ArticleTitle>
                <AuthorList><Author><LastName>Liu</LastName><ForeName>Ada</ForeName></Author>
                <Author><CollectiveName>PaperPilot Consortium</CollectiveName></Author></AuthorList>
                <Abstract><AbstractText Label="BACKGROUND">First section.</AbstractText>
                <AbstractText>Second section.</AbstractText></Abstract>
                <Journal><ISSN IssnType="Print">0028-0836</ISSN><JournalIssue><PubDate><Year>2025</Year></PubDate></JournalIssue><Title>Nature</Title></Journal>
                </Article></MedlineCitation><PubmedData><ArticleIdList>
                <ArticleId IdType="doi">10.1000/Test</ArticleId>
                </ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>"#,
        )
        .unwrap();
        assert_eq!(papers.len(), 1);
        assert_eq!(papers[0].paper_id, "pmid:12345");
        assert_eq!(papers[0].authors, vec!["Ada Liu", "PaperPilot Consortium"]);
        assert_eq!(papers[0].excerpt, "First section. Second section.");
        assert_eq!(papers[0].journal.as_deref(), Some("Nature"));
        assert_eq!(papers[0].issn.as_deref(), Some("0028-0836"));
        assert_eq!(papers[0].sources, vec![PUBMED]);
    }

    #[test]
    fn reconstructs_openalex_abstract_by_token_position() {
        let abstract_index = HashMap::from([
            ("evidence".to_owned(), vec![2]),
            ("Real".to_owned(), vec![0]),
            ("search".to_owned(), vec![1]),
        ]);
        assert_eq!(
            reconstruct_openalex_abstract(abstract_index).as_deref(),
            Some("Real search evidence")
        );
    }

    #[test]
    fn deserializes_provider_cursors_for_exhaustive_pagination() {
        let europe: EuropePmcResponse = serde_json::from_value(json!({
            "hitCount": 3473,
            "nextCursorMark": "next-europe",
            "resultList": {"result": []}
        }))
        .unwrap();
        let openalex: OpenAlexResponse = serde_json::from_value(json!({
            "meta": {"count": 26, "next_cursor": "next-openalex"},
            "results": []
        }))
        .unwrap();
        let crossref: CrossrefResponse = serde_json::from_value(json!({
            "message": {
                "total-results": 250000,
                "next-cursor": "next-crossref",
                "items": []
            }
        }))
        .unwrap();

        assert_eq!(europe.next_cursor_mark.as_deref(), Some("next-europe"));
        assert_eq!(openalex.meta.next_cursor.as_deref(), Some("next-openalex"));
        assert_eq!(
            crossref.message.next_cursor.as_deref(),
            Some("next-crossref")
        );
        assert_eq!(EUROPE_PMC_PAGE_SIZE, 1_000);
        assert_eq!(OPENALEX_PAGE_SIZE, 200);
        assert_eq!(CROSSREF_PAGE_SIZE, 500);
        assert_eq!(CROSSREF_MAX_SEARCH_RESULTS, 1_000);
    }

    #[test]
    fn accepts_openalex_sources_with_null_issn_lists() {
        let response: OpenAlexResponse = serde_json::from_value(json!({
            "meta": {"count": 1, "next_cursor": null},
            "results": [{
                "id": "https://openalex.org/W123",
                "doi": null,
                "title": "Relevant disease dataset study",
                "publication_year": 2025,
                "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/12345678"},
                "primary_location": {
                    "source": {
                        "display_name": "Repository journal",
                        "issn_l": null,
                        "issn": null
                    }
                },
                "abstract_inverted_index": {
                    "Relevant": [0],
                    "disease": [1],
                    "evidence": [2]
                }
            }]
        }))
        .expect("OpenAlex permits a null ISSN list");

        let paper =
            SourcePaper::from_openalex(response.results.into_iter().next().expect("one work"))
                .expect("work remains usable without ISSNs");
        assert_eq!(paper.paper_id, "pmid:12345678");
        assert_eq!(paper.journal.as_deref(), Some("Repository journal"));
        assert_eq!(paper.issn, None);
    }

    #[test]
    fn parses_portable_boolean_query_into_required_concept_groups() {
        assert_eq!(
            boolean_query_groups(
                r#"("PD-1" OR "programmed death 1") AND (resistance OR refractory)"#
            ),
            vec![
                vec!["PD-1".to_owned(), "programmed death 1".to_owned()],
                vec!["resistance".to_owned(), "refractory".to_owned()],
            ]
        );
    }

    #[test]
    fn accepts_common_search_query_keys_and_normalizes_model_newlines() {
        assert_eq!(
            parse_search_query_value(&json!({
                "searchQuery": "(glaucoma OR ocular hypertension)\nAND\n(single cell)"
            }))
            .unwrap(),
            "(glaucoma OR ocular hypertension) AND (single cell)"
        );
        assert_eq!(
            parse_search_query_value(&json!({
                "query": ["glaucoma", "single cell", "macrophage"]
            }))
            .unwrap(),
            "glaucoma AND single cell AND macrophage"
        );
        assert_eq!(
            parse_search_query_value(&json!({
                "searchStrategy": {
                    "portable": {
                        "expression": "(glaucoma) AND (single cell) AND (macrophage)"
                    }
                }
            }))
            .unwrap(),
            "(glaucoma) AND (single cell) AND (macrophage)"
        );
        assert_eq!(
            parse_search_query_value(&json!({
                "conceptGroups": [
                    {"terms": ["glaucoma", "ocular hypertension"]},
                    {"terms": ["single cell", "single-cell RNA sequencing"]},
                    {"terms": ["macrophage", "microglia"]}
                ]
            }))
            .unwrap(),
            "(glaucoma OR ocular hypertension) AND (single cell OR single-cell RNA sequencing) AND (macrophage OR microglia)"
        );
    }

    #[test]
    fn falls_back_to_user_keywords_when_model_query_shape_is_unusable() {
        let mut brief = crate::contracts::ResearchBrief {
            question: "青光眼单细胞中的巨噬细胞研究".into(),
            population: None,
            intervention: None,
            comparison: None,
            outcomes: vec![],
            keywords: vec!["glaucoma".into(), "single cell".into(), "macrophage".into()],
            date_from: Some(2010),
            date_to: Some(2026),
            study_types: vec![],
        };
        assert_eq!(
            fallback_search_query(&brief).unwrap(),
            "\"glaucoma\" AND \"single cell\" AND \"macrophage\""
        );
        brief.keywords.clear();
        assert_eq!(
            fallback_search_query(&brief).unwrap(),
            "青光眼单细胞中的巨噬细胞研究"
        );
    }

    #[test]
    fn crossref_results_are_included_when_the_abstract_contains_a_query_keyword() {
        let relevant = CrossrefWork {
            doi: Some("10.1000/relevant".into()),
            title: vec!["PD-1 blockade resistance in melanoma".into()],
            r#abstract: Some("PD-1 mechanisms of refractory disease.".into()),
            published: None,
            container_title: vec!["Cancer Research".into()],
            issn: vec!["0008-5472".into()],
            author: vec![CrossrefAuthor {
                given: Some("Ada".into()),
                family: Some("Liu".into()),
                name: None,
            }],
        };
        let broad_but_irrelevant = CrossrefWork {
            doi: Some("10.1000/irrelevant".into()),
            title: vec!["Treatment resistance in melanoma".into()],
            r#abstract: Some("A broad oncology review.".into()),
            published: None,
            container_title: vec![],
            issn: vec![],
            author: vec![],
        };
        let query = r#"("PD-1" OR "programmed death 1") AND (resistance OR refractory)"#;

        assert!(source_paper_abstract_contains_query_keyword(
            &SourcePaper::from_crossref(relevant).unwrap(),
            query
        ));
        assert!(!source_paper_abstract_contains_query_keyword(
            &SourcePaper::from_crossref(broad_but_irrelevant).unwrap(),
            query
        ));
    }

    #[test]
    fn source_papers_are_included_when_the_abstract_contains_any_query_keyword() {
        let paper = SourcePaper {
            paper_id: "openalex:W1".into(),
            title: "PD-1 blockade in melanoma".into(),
            authors: vec!["Ada Liu".into()],
            excerpt: "Acquired resistance limits durable response.".into(),
            year: Some("2025".into()),
            journal: Some("Example Journal".into()),
            issn: Some("1234-5678".into()),
            sources: vec!["OpenAlex".into()],
        };
        let query = r#"("PD-1" OR "programmed death 1") AND (resistance OR refractory)"#;

        assert!(source_paper_abstract_contains_query_keyword(&paper, query));
        assert!(!source_paper_abstract_contains_query_keyword(
            &paper,
            r#"(CTLA-4) AND (ipilimumab)"#
        ));
        let title_only = SourcePaper {
            excerpt: "Durable response was evaluated.".into(),
            ..paper
        };
        assert!(!source_paper_abstract_contains_query_keyword(
            &title_only,
            query
        ));
    }

    #[test]
    fn builds_a_date_limited_google_scholar_manual_search_url() {
        assert_eq!(
            google_scholar_search_url("(single cell) AND (glaucoma)", 2010, 2026),
            "https://scholar.google.com/scholar?q=%28single%20cell%29%20AND%20%28glaucoma%29&as_ylo=2010&as_yhi=2026"
        );
    }

    #[test]
    fn merges_duplicate_identifiers_and_preserves_all_sources() {
        let merged = merge_duplicate_papers(vec![
            SourcePaper {
                paper_id: "doi:10.1000/example".into(),
                title: "Shared title".into(),
                authors: vec!["Ada Liu".into()],
                excerpt: "Short abstract.".into(),
                year: Some("2024".into()),
                journal: None,
                issn: None,
                sources: vec![EUROPE_PMC.into()],
            },
            SourcePaper {
                paper_id: "doi:10.1000/example".into(),
                title: "A different provider title".into(),
                authors: vec!["Bo Wang".into()],
                excerpt: "A longer abstract returned by the second database.".into(),
                year: Some("2024".into()),
                journal: Some("Shared Journal".into()),
                issn: Some("1234-5678".into()),
                sources: vec![CROSSREF.into()],
            },
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].sources, vec![EUROPE_PMC, CROSSREF]);
        assert_eq!(merged[0].authors, vec!["Ada Liu", "Bo Wang"]);
        assert!(merged[0].excerpt.starts_with("A longer"));
    }
}
