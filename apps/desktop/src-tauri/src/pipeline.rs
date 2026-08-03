use chrono::Utc;
use thiserror::Error;
use uuid::Uuid;

use crate::{
    CONTRACT_VERSION,
    contracts::{
        Claim, ConversationMessage, DatasetModality, EvidenceRecord, MessageAction, MessageResult,
        Project, PublicDataset, Recommendation, Report, ResearchBrief, ResearchRun, RunEvent,
        RunOperation, RunSnapshot, RunStatus, validate_report,
    },
    live_research::{LiveResearchBackend, LiveResearchError, LiveResearchTrace},
    storage::{LocalStore, StorageError},
};

const STAGES: [(&str, &str, &str); 9] = [
    ("structure_question", "问题结构化", "已形成结构化研究问题。"),
    ("search_sources", "多源检索", "已检索真实文献来源。"),
    (
        "deduplicate",
        "标识归一化与去重",
        "已按 PMID、PMCID、DOI 和标题去重。",
    ),
    ("screen", "相关性筛选", "已保留与研究问题相关的文献。"),
    ("parse", "文献解析", "已提取可定位的摘要文本。"),
    (
        "create_evidence",
        "证据抽取",
        "已创建不可变 Evidence Record。",
    ),
    ("synthesize", "研究综合", "已形成证据支持的主要结论。"),
    ("recommend", "下一步建议", "已生成恰好三个可检验方案。"),
    ("citation_audit", "引用审计", "主要结论证据覆盖率为 100%。"),
];

const MAX_CONVERSATION_HISTORY_MESSAGES: usize = 12;
const REPEATED_REPLY_FALLBACK: &str = "当前 Evidence Record 没有提供超出前述回答的新信息。如需继续分析，请提出新的比较维度或研究约束。";

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("report validation failed: {0}")]
    Validation(String),
    #[error("run is not ready for this operation")]
    InvalidState,
    #[error(transparent)]
    Live(#[from] LiveResearchError),
}

pub struct ResearchEngine {
    store: LocalStore,
}

impl ResearchEngine {
    pub fn new(store: LocalStore) -> Self {
        Self { store }
    }

    pub fn create_run(
        &self,
        project_id: &str,
        brief: ResearchBrief,
    ) -> Result<ResearchRun, PipelineError> {
        Ok(self.store.create_run(project_id, &brief)?)
    }

    pub fn retry_failed_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        let run = self.store.get_run(run_id)?;
        if run.status != RunStatus::Failed {
            return Err(PipelineError::InvalidState);
        }
        let brief = self.store.get_brief(run_id)?;
        Ok(self.store.create_run(&run.project_id, &brief)?)
    }

    pub fn create_project(&self, name: &str, description: &str) -> Result<Project, PipelineError> {
        Ok(self.store.create_project(name, description)?)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, PipelineError> {
        Ok(self.store.list_projects()?)
    }

    pub fn get_latest_project_run(
        &self,
        project_id: &str,
    ) -> Result<Option<ResearchRun>, PipelineError> {
        Ok(self.store.get_latest_project_run(project_id)?)
    }

    pub fn list_project_run_snapshots(
        &self,
        project_id: &str,
    ) -> Result<Vec<RunSnapshot>, PipelineError> {
        Ok(self.store.list_project_run_snapshots(project_id)?)
    }

    pub fn delete_project(&self, project_id: &str) -> Result<(), PipelineError> {
        Ok(self.store.delete_project(project_id)?)
    }

    pub fn cancel_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        let run = self.store.get_run(run_id)?;
        if !matches!(
            run.status,
            RunStatus::Queued | RunStatus::Running | RunStatus::Waiting | RunStatus::Retrying
        ) {
            return Err(PipelineError::InvalidState);
        }
        if let Some(mut operation) = self
            .store
            .list_operations(run_id)?
            .into_iter()
            .rev()
            .find(|operation| operation.status == "running")
        {
            operation.status = "cancelled".into();
            operation.summary = format!("{}\n任务已由用户停止。", operation.summary.trim());
            self.store.save_operation(&operation)?;
        }
        Ok(self.store.update_run(
            run_id,
            RunStatus::Cancelled,
            run.stage.as_deref(),
            run.progress,
            run.report_version,
        )?)
    }

    pub fn wait_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        let run = self.store.get_run(run_id)?;
        if run.status == RunStatus::Cancelled {
            return Ok(run);
        }
        if !matches!(run.status, RunStatus::Running | RunStatus::Retrying) {
            return Err(PipelineError::InvalidState);
        }
        Ok(self.store.update_run(
            run_id,
            RunStatus::Waiting,
            run.stage.as_deref(),
            run.progress,
            run.report_version,
        )?)
    }

    pub fn resume_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        self.execute_demo_run(run_id)
    }

    pub fn execute_demo_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        self.execute_demo_run_with_events(run_id, |_| {})
    }

    pub fn execute_demo_run_with_observer<F>(
        &self,
        run_id: &str,
        observer: F,
    ) -> Result<ResearchRun, PipelineError>
    where
        F: FnMut(RunEvent),
    {
        self.execute_demo_run_with_events(run_id, observer)
    }

    pub fn fail_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        let run = self.store.get_run(run_id)?;
        Ok(self.store.update_run(
            run_id,
            RunStatus::Failed,
            run.stage.as_deref(),
            run.progress,
            run.report_version,
        )?)
    }

    pub fn fail_run_with_reason(
        &self,
        run_id: &str,
        summary: &str,
    ) -> Result<ResearchRun, PipelineError> {
        let failed = self.fail_run(run_id)?;
        if let Some(mut operation) = self
            .store
            .list_operations(run_id)?
            .into_iter()
            .rev()
            .find(|operation| operation.status == "running")
        {
            operation.status = "failed".into();
            operation.summary = summary.into();
            self.store.save_operation(&operation)?;
        }
        let sequence = self.store.next_timeline_sequence(run_id)?;
        self.store.save_message(&ConversationMessage {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            sequence,
            role: "assistant".into(),
            content: summary.into(),
            evidence_ids: vec![],
            report_version: None,
            created_at: Utc::now(),
        })?;
        Ok(failed)
    }

    pub fn execute_demo_run_with_events<F>(
        &self,
        run_id: &str,
        mut on_event: F,
    ) -> Result<ResearchRun, PipelineError>
    where
        F: FnMut(RunEvent),
    {
        let run = self.store.get_run(run_id)?;
        if !matches!(
            run.status,
            RunStatus::Queued | RunStatus::Waiting | RunStatus::Retrying
        ) {
            return Err(PipelineError::InvalidState);
        }

        let operations = self.store.list_operations(run_id)?;
        let completed_stages = operations
            .iter()
            .enumerate()
            .take_while(|(index, operation)| {
                operation.sequence == *index as u64 + 1 && operation.status == "completed"
            })
            .count()
            .min(STAGES.len());
        let resumed_progress = ((completed_stages * 100) / STAGES.len()) as u8;
        let resumed_stage = STAGES[completed_stages.min(STAGES.len() - 1)].0;
        self.store.update_run(
            run_id,
            RunStatus::Running,
            Some(resumed_stage),
            resumed_progress,
            run.report_version,
        )?;

        for (index, (kind, title, summary)) in STAGES.iter().enumerate().skip(completed_stages) {
            let current = self.store.get_run(run_id)?;
            if current.status != RunStatus::Running {
                return Ok(current);
            }
            let sequence = index as u64 + 1;
            let progress = (((index + 1) * 100) / STAGES.len()) as u8;
            let operation = RunOperation {
                id: Uuid::new_v4().to_string(),
                run_id: run_id.into(),
                sequence,
                operation_kind: (*kind).into(),
                stage: (*kind).into(),
                title: (*title).into(),
                summary: (*summary).into(),
                status: "completed".into(),
                created_at: Utc::now(),
            };
            self.store.save_operation(&operation)?;
            let updated =
                self.store
                    .update_run(run_id, RunStatus::Running, Some(kind), progress, 0)?;
            on_event(RunEvent {
                contract_version: CONTRACT_VERSION.into(),
                run_id: run_id.into(),
                sequence,
                status: updated.status,
                stage: updated.stage,
                progress: updated.progress,
                operation: Some(operation),
                safe_summary: (*summary).into(),
            });
        }

        let current = self.store.get_run(run_id)?;
        if current.status != RunStatus::Running {
            return Ok(current);
        }
        let evidence = demo_evidence(run_id);
        for record in &evidence {
            self.store.save_evidence(record)?;
        }
        let report = demo_report(run_id, 1, evidence);
        validate_report(&report).map_err(PipelineError::Validation)?;
        self.store.save_report(&report)?;
        let completion_sequence = self.store.next_timeline_sequence(run_id)?;
        self.store.save_message(&ConversationMessage {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            sequence: completion_sequence,
            role: "assistant".into(),
            content: "完整报告已生成在右侧，包含 3 个可检验的下一步方案。".into(),
            evidence_ids: vec![],
            report_version: Some(1),
            created_at: Utc::now(),
        })?;
        let completed =
            self.store
                .update_run(run_id, RunStatus::Completed, Some("citation_audit"), 100, 1)?;
        on_event(RunEvent {
            contract_version: CONTRACT_VERSION.into(),
            run_id: run_id.into(),
            sequence: STAGES.len() as u64 + 1,
            status: completed.status,
            stage: completed.stage.clone(),
            progress: completed.progress,
            operation: None,
            safe_summary: "完整报告已通过引用审计。".into(),
        });
        Ok(completed)
    }

    pub fn execute_live_run_with_events<B, F>(
        &self,
        run_id: &str,
        backend: &B,
        mut on_event: F,
    ) -> Result<ResearchRun, PipelineError>
    where
        B: LiveResearchBackend + ?Sized,
        F: FnMut(RunEvent),
    {
        let run = self.store.get_run(run_id)?;
        if !matches!(
            run.status,
            RunStatus::Queued | RunStatus::Waiting | RunStatus::Retrying
        ) {
            return Err(PipelineError::InvalidState);
        }
        let brief = self.store.get_brief(run_id)?;
        self.store.update_run(
            run_id,
            RunStatus::Running,
            Some(STAGES[0].0),
            0,
            run.report_version,
        )?;

        self.record_live_stage(
            run_id,
            0,
            "模型正在把研究问题转换为可执行的生物医学检索式。",
            "running",
            &mut on_event,
        )?;
        let mut recorded = [false; 6];
        let mut source_progress: Vec<(String, String)> = Vec::new();
        let mut trace_error = None;
        let evidence_result = backend.collect_evidence_with_trace(run_id, &brief, &mut |trace| {
            if trace_error.is_some() {
                return;
            }
            let stages = match trace {
                LiveResearchTrace::SearchQueryBuilt { query } => vec![(
                    0,
                    format!("模型已生成多数据库检索式：{query}"),
                    "completed",
                )],
                LiveResearchTrace::SourceSearchStarted { source } => {
                    let detail = format!("{source}：正在检索…");
                    if let Some(item) = source_progress
                        .iter_mut()
                        .find(|(name, _)| name == &source)
                    {
                        item.1 = detail;
                    } else {
                        source_progress.push((source, detail));
                    }
                    vec![(
                        1,
                        format!(
                            "正在逐源检索真实文献：\n{}",
                            source_progress
                                .iter()
                                .map(|(_, detail)| detail.as_str())
                                .collect::<Vec<_>>()
                                .join("\n")
                        ),
                        "running",
                    )]
                }
                LiveResearchTrace::ManualSourceSearchAvailable { source, url } => {
                    let detail =
                        format!("{source}：已生成手动补充检索入口（官方未提供自动检索 API）：{url}");
                    if let Some(item) = source_progress
                        .iter_mut()
                        .find(|(name, _)| name == &source)
                    {
                        item.1 = detail;
                    } else {
                        source_progress.push((source, detail));
                    }
                    vec![(
                        1,
                        format!(
                            "正在逐源检索真实文献：\n{}",
                            source_progress
                                .iter()
                                .map(|(_, detail)| detail.as_str())
                                .collect::<Vec<_>>()
                                .join("\n")
                        ),
                        "running",
                    )]
                }
                LiveResearchTrace::SourcesRetrieved {
                    source,
                    matched_count,
                    batch_count,
                    returned_count,
                    usable_count,
                    unique_count,
                    reached_limit,
                } => {
                    let match_summary = format!("摘要关键词命中并纳入评分 {matched_count} 篇");
                    let detail = format!(
                        "{source}：按相关性排序读取 {batch_count} 批，累计 {returned_count} 篇；{match_summary}，可用摘要 {usable_count} 篇，源内唯一 {unique_count} 篇{}",
                        if reached_limit {
                            "（已达到本次深度检索上限）"
                        } else {
                            ""
                        }
                    );
                    if let Some(item) = source_progress
                        .iter_mut()
                        .find(|(name, _)| name == &source)
                    {
                        item.1 = detail;
                    } else {
                        source_progress.push((source, detail));
                    }
                    vec![(
                        1,
                        format!(
                            "正在逐源检索真实文献：\n{}",
                            source_progress
                                .iter()
                                .map(|(_, detail)| detail.as_str())
                                .collect::<Vec<_>>()
                                .join("\n")
                        ),
                        "running",
                    )]
                }
                LiveResearchTrace::SourceRetrievalFailed { source, reason } => {
                    let detail = format!("{source}：检索失败（{reason}），已继续其他来源");
                    if let Some(item) = source_progress
                        .iter_mut()
                        .find(|(name, _)| name == &source)
                    {
                        item.1 = detail;
                    } else {
                        source_progress.push((source, detail));
                    }
                    vec![(
                        1,
                        format!(
                            "正在逐源检索真实文献：\n{}",
                            source_progress
                                .iter()
                                .map(|(_, detail)| detail.as_str())
                                .collect::<Vec<_>>()
                                .join("\n")
                        ),
                        "running",
                    )]
                }
                LiveResearchTrace::SourcesMerged {
                    collected_count,
                    unique_count,
                    candidate_count,
                } => vec![
                    (
                        1,
                        format!(
                            "多源检索完成：\n{}",
                            source_progress
                                .iter()
                                .map(|(_, detail)| detail.as_str())
                                .collect::<Vec<_>>()
                                .join("\n")
                        ),
                        "completed",
                    ),
                    (
                        2,
                        format!(
                            "四个自动来源共收集 {collected_count} 条记录；按 PMID、PMCID、DOI 和规范化标题合并为 {unique_count} 篇，进入评分候选 {candidate_count} 篇；Google Scholar 提供手动补充核验入口。"
                        ),
                        "completed",
                    ),
                ],
                LiveResearchTrace::RankingProgress {
                    evaluated_count,
                    total_count,
                    above_threshold_count,
                    ranked,
                } => {
                    let interpretations = ranked
                        .iter()
                        .enumerate()
                        .map(|(index, item)| {
                            format!(
                                "{}. [{}/20][{}][{}] {} — {}{}",
                                index + 1,
                                item.score,
                                item.year,
                                item.source,
                                item.title,
                                item.reason,
                                if item.included {
                                    "（达到证据阈值）"
                                } else {
                                    "（仅保留检索记录）"
                                }
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    vec![(
                        3,
                        format!(
                            "模型正在分批逐篇解读高相关候选文献：已完成 {evaluated_count}/{total_count} 篇，其中 ≥1 分 {above_threshold_count} 篇。\n{interpretations}"
                        ),
                        "running",
                    )]
                }
                LiveResearchTrace::SourcesRanked {
                    evaluated_count,
                    above_threshold_count,
                    selected,
                } => {
                    let ranking = selected
                        .iter()
                        .enumerate()
                        .map(|(index, item)| {
                            format!(
                                "{}. [{}/20][{}][{}] {} — {}{}",
                                index + 1,
                                item.score,
                                item.year,
                                item.source,
                                item.title,
                                item.reason,
                                if item.included {
                                    "（纳入证据抽取）"
                                } else {
                                    "（不纳入报告证据）"
                                }
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    vec![(
                        3,
                        format!(
                            "模型已逐篇解读并展示全部 {evaluated_count} 篇去重候选文献；≥1 分的有 {above_threshold_count} 篇并全部进入证据抽取。以下按分数从高到低排列：\n{ranking}"
                        ),
                        "completed",
                    )]
                }
                LiveResearchTrace::EvidenceExtractionProgress {
                    extracted_count,
                    total_count,
                } => vec![(
                    4,
                    format!(
                        "模型正在逐篇提取高相关文献证据：已完成 {extracted_count}/{total_count} 篇。"
                    ),
                    "running",
                )],
                LiveResearchTrace::EvidenceExtracted { selected_count } => vec![(
                    4,
                    format!(
                        "已逐篇解析全部 {selected_count} 篇达到阈值的文献摘要，并保留可定位的原文片段。"
                    ),
                    "completed",
                )],
            };
            for (index, summary, status) in stages {
                if let Err(error) =
                    self.record_live_stage(run_id, index, &summary, status, &mut on_event)
                {
                    trace_error = Some(error);
                    return;
                }
                if status == "completed" {
                    recorded[index] = true;
                }
            }
        });
        if let Some(error) = trace_error {
            return Err(error);
        }
        let current = self.store.get_run(run_id)?;
        if current.status != RunStatus::Running {
            return Ok(current);
        }
        let evidence = evidence_result?;
        let fallback_summaries = [
            "模型已完成研究问题结构化。",
            "研究后端已返回可用的真实文献记录。",
            "文献标识与标题归一化已完成。",
            "模型已完成文献相关性筛选。",
            "可定位的文献摘要解析已完成。",
        ];
        for (index, summary) in fallback_summaries.iter().enumerate() {
            if !recorded[index] {
                self.record_live_stage(run_id, index, summary, "completed", &mut on_event)?;
            }
        }

        for record in &evidence {
            self.store.save_evidence(record)?;
        }
        self.record_live_stage(
            run_id,
            5,
            &format!(
                "已创建并加密保存 {} 条不可变 Evidence Record。",
                evidence.len()
            ),
            "completed",
            &mut on_event,
        )?;

        self.record_live_stage(
            run_id,
            6,
            "模型正在基于已纳入的 Evidence Record 生成研究综合。",
            "running",
            &mut on_event,
        )?;
        let related_datasets = backend.search_public_datasets(&brief);
        let report_result = backend.synthesize_report(run_id, 1, &brief, &evidence, None);
        let current = self.store.get_run(run_id)?;
        if current.status != RunStatus::Running {
            return Ok(current);
        }
        let mut report = report_result?;
        report.related_datasets = related_datasets;
        self.record_live_stage(
            run_id,
            6,
            &format!(
                "模型已生成研究综合：形成 {} 条有证据引用的主要结论。",
                report.claims.len()
            ),
            "completed",
            &mut on_event,
        )?;
        self.record_live_stage(
            run_id,
            7,
            &format!(
                "模型已生成 {} 个可检验的下一步方案。",
                report.recommendations.len()
            ),
            "completed",
            &mut on_event,
        )?;
        validate_report(&report).map_err(PipelineError::Validation)?;
        self.store.save_report(&report)?;
        let cited_claims = report
            .claims
            .iter()
            .filter(|claim| !claim.evidence_ids.is_empty())
            .count();
        let coverage = if report.claims.is_empty() {
            0
        } else {
            cited_claims * 100 / report.claims.len()
        };
        self.record_live_stage(
            run_id,
            8,
            &format!(
                "引用审计通过：{cited_claims}/{} 条主要结论有 Evidence Record，覆盖率 {coverage}%。",
                report.claims.len()
            ),
            "completed",
            &mut on_event,
        )?;

        let current = self.store.get_run(run_id)?;
        if current.status != RunStatus::Running {
            return Ok(current);
        }
        let completion_sequence = self.store.next_timeline_sequence(run_id)?;
        self.store.save_message(&ConversationMessage {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            sequence: completion_sequence,
            role: "assistant".into(),
            content: format!(
                "报告已生成（{} 条主要结论、{} 个下一步方案），可在右侧查看完整内容。",
                report.claims.len(),
                report.recommendations.len()
            ),
            evidence_ids: report
                .claims
                .iter()
                .flat_map(|claim| claim.evidence_ids.iter().cloned())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect(),
            report_version: Some(1),
            created_at: Utc::now(),
        })?;
        let completed =
            self.store
                .update_run(run_id, RunStatus::Completed, Some("citation_audit"), 100, 1)?;
        on_event(RunEvent {
            contract_version: CONTRACT_VERSION.into(),
            run_id: run_id.into(),
            sequence: completion_sequence + 1,
            status: completed.status,
            stage: completed.stage.clone(),
            progress: completed.progress,
            operation: None,
            safe_summary: "完整报告已通过引用审计。".into(),
        });
        Ok(completed)
    }

    fn record_live_stage<F>(
        &self,
        run_id: &str,
        index: usize,
        summary: &str,
        status: &str,
        on_event: &mut F,
    ) -> Result<(), PipelineError>
    where
        F: FnMut(RunEvent),
    {
        if self.store.get_run(run_id)?.status != RunStatus::Running {
            return Ok(());
        }
        let (kind, title, _) = STAGES[index];
        let sequence = index as u64 + 1;
        let progress = if status == "completed" {
            (((index + 1) * 100) / STAGES.len()) as u8
        } else {
            ((index * 100) / STAGES.len()) as u8
        };
        let operation = RunOperation {
            id: format!("{run_id}-stage-{kind}"),
            run_id: run_id.into(),
            sequence,
            operation_kind: kind.into(),
            stage: kind.into(),
            title: title.into(),
            summary: summary.into(),
            status: status.into(),
            created_at: Utc::now(),
        };
        self.store.save_operation(&operation)?;
        let updated = self
            .store
            .update_run(run_id, RunStatus::Running, Some(kind), progress, 0)?;
        on_event(RunEvent {
            contract_version: CONTRACT_VERSION.into(),
            run_id: run_id.into(),
            sequence,
            status: updated.status,
            stage: updated.stage,
            progress: updated.progress,
            operation: Some(operation),
            safe_summary: summary.into(),
        });
        Ok(())
    }

    pub fn get_run_snapshot(&self, run_id: &str) -> Result<RunSnapshot, PipelineError> {
        Ok(self.store.run_snapshot(run_id)?)
    }

    pub fn get_report(&self, run_id: &str, version: Option<u32>) -> Result<Report, PipelineError> {
        Ok(self.store.get_report(run_id, version)?)
    }

    pub fn get_evidence(
        &self,
        run_id: &str,
        evidence_id: &str,
    ) -> Result<EvidenceRecord, PipelineError> {
        Ok(self.store.get_evidence(run_id, evidence_id)?)
    }

    pub fn send_message(
        &self,
        run_id: &str,
        content: &str,
    ) -> Result<MessageResult, PipelineError> {
        let run = self.store.get_run(run_id)?;
        if run.status != RunStatus::Completed {
            return Err(PipelineError::InvalidState);
        }
        let user_sequence = self.store.next_timeline_sequence(run_id)?;
        self.store.save_message(&ConversationMessage {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            sequence: user_sequence,
            role: "user".into(),
            content: content.into(),
            evidence_ids: vec![],
            report_version: Some(run.report_version),
            created_at: Utc::now(),
        })?;

        let action = classify_intent(content);
        let (report_updated, report_version, response, evidence_ids) = match action {
            MessageAction::Discuss => (
                false,
                run.report_version,
                "现有证据显示，外部队列验证能以最低新增样本成本检验跨队列复现性。".into(),
                vec![format!("{run_id}-evidence-1")],
            ),
            MessageAction::ReviseReport => {
                let mut report = self.store.get_report(run_id, None)?;
                report.version += 1;
                report.summary = format!("已根据新增约束修订：{content}");
                report.created_at = Utc::now();
                validate_report(&report).map_err(PipelineError::Validation)?;
                self.store.save_report(&report)?;
                self.store.update_run(
                    run_id,
                    RunStatus::Completed,
                    Some("citation_audit"),
                    100,
                    report.version,
                )?;
                (
                    true,
                    report.version,
                    format!("已自动生成报告 v{}，旧版本仍保留在本机。", report.version),
                    vec![],
                )
            }
        };
        let message = ConversationMessage {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            sequence: user_sequence + 1,
            role: "assistant".into(),
            content: response,
            evidence_ids,
            report_version: Some(report_version),
            created_at: Utc::now(),
        };
        self.store.save_message(&message)?;
        Ok(MessageResult {
            message,
            action,
            report_updated,
            report_version,
        })
    }

    pub fn send_live_message<B: LiveResearchBackend + ?Sized>(
        &self,
        run_id: &str,
        content: &str,
        backend: &B,
    ) -> Result<MessageResult, PipelineError> {
        let run = self.store.get_run(run_id)?;
        if run.status != RunStatus::Completed {
            return Err(PipelineError::InvalidState);
        }
        let action = classify_intent(content);
        let current_report = self.store.get_report(run_id, None)?;
        let brief = self.store.get_brief(run_id)?;
        let history = self.recent_project_conversation(&run.project_id)?;
        let (report_updated, report_version, response, evidence_ids) = match action {
            MessageAction::Discuss => {
                let reply = backend.grounded_reply(content, &current_report, &history)?;
                let content = if repeats_prior_answer(&reply.content, &history) {
                    REPEATED_REPLY_FALLBACK.into()
                } else {
                    reply.content
                };
                (false, run.report_version, content, reply.evidence_ids)
            }
            MessageAction::ReviseReport => {
                let version = run.report_version + 1;
                let mut revised = backend.synthesize_report(
                    run_id,
                    version,
                    &brief,
                    &current_report.evidence,
                    Some(content),
                )?;
                revised.related_datasets = current_report.related_datasets.clone();
                validate_report(&revised).map_err(PipelineError::Validation)?;
                self.store.save_report(&revised)?;
                self.store.update_run(
                    run_id,
                    RunStatus::Completed,
                    Some("citation_audit"),
                    100,
                    version,
                )?;
                (
                    true,
                    version,
                    format!("报告 v{version} 已生成并保存；旧版本仍保留在本机。"),
                    vec![],
                )
            }
        };

        let user_sequence = self.store.next_timeline_sequence(run_id)?;
        self.store.save_message(&ConversationMessage {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            sequence: user_sequence,
            role: "user".into(),
            content: content.into(),
            evidence_ids: vec![],
            report_version: Some(run.report_version),
            created_at: Utc::now(),
        })?;
        let message = ConversationMessage {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            sequence: user_sequence + 1,
            role: "assistant".into(),
            content: response,
            evidence_ids,
            report_version: Some(report_version),
            created_at: Utc::now(),
        };
        self.store.save_message(&message)?;
        Ok(MessageResult {
            message,
            action,
            report_updated,
            report_version,
        })
    }

    fn recent_project_conversation(
        &self,
        project_id: &str,
    ) -> Result<Vec<ConversationMessage>, PipelineError> {
        let mut messages = self
            .store
            .list_project_run_snapshots(project_id)?
            .into_iter()
            .flat_map(|snapshot| {
                let run_id = snapshot.run.id.clone();
                let synthetic_question = ConversationMessage {
                    id: format!("history:{run_id}:brief"),
                    run_id,
                    sequence: 0,
                    role: "user".into(),
                    content: snapshot.brief.question,
                    evidence_ids: vec![],
                    report_version: (snapshot.run.report_version > 0)
                        .then_some(snapshot.run.report_version),
                    created_at: snapshot.run.created_at,
                };
                std::iter::once(synthetic_question).chain(snapshot.messages)
            })
            .filter(|message| {
                matches!(message.role.as_str(), "user" | "assistant")
                    && !is_automatic_completion_message(message)
            })
            .collect::<Vec<_>>();
        if messages.len() > MAX_CONVERSATION_HISTORY_MESSAGES {
            messages = messages.split_off(messages.len() - MAX_CONVERSATION_HISTORY_MESSAGES);
        }
        Ok(messages)
    }
}

fn is_automatic_completion_message(message: &ConversationMessage) -> bool {
    message.role == "assistant"
        && (message.content.starts_with("报告已生成（")
            || message.content.starts_with("已依据检索证据生成报告：")
            || message.content.starts_with("完整报告已生成在右侧"))
}

fn repeats_prior_answer(response: &str, history: &[ConversationMessage]) -> bool {
    let normalized_response = normalize_for_comparison(response);
    if normalized_response.is_empty() {
        return false;
    }
    history
        .iter()
        .filter(|message| message.role == "assistant")
        .map(|message| normalize_for_comparison(&message.content))
        .any(|previous| {
            if previous == normalized_response {
                return true;
            }
            let shorter = previous
                .chars()
                .count()
                .min(normalized_response.chars().count());
            let longer = previous
                .chars()
                .count()
                .max(normalized_response.chars().count());
            shorter >= 24
                && shorter * 100 >= longer * 80
                && (previous.contains(&normalized_response)
                    || normalized_response.contains(&previous))
        })
}

fn normalize_for_comparison(content: &str) -> String {
    content
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn classify_intent(content: &str) -> MessageAction {
    const DISCUSSION_MARKERS: [&str; 5] = ["为什么", "为何", "如何", "依据", "证据"];
    if DISCUSSION_MARKERS
        .iter()
        .any(|marker| content.contains(marker))
    {
        return MessageAction::Discuss;
    }
    const REVISION_MARKERS: [&str; 8] = [
        "把",
        "请将",
        "调整",
        "修改",
        "纠正",
        "改为",
        "补充",
        "限制为",
    ];
    if REVISION_MARKERS
        .iter()
        .any(|marker| content.contains(marker))
    {
        MessageAction::ReviseReport
    } else {
        MessageAction::Discuss
    }
}

fn demo_evidence(run_id: &str) -> Vec<EvidenceRecord> {
    [
        (
            "抗原呈递缺陷与原发耐药稳定相关。",
            "Liu et al. 观察到抗原呈递通路缺陷与较低响应率相关。",
        ),
        (
            "耗竭表型的预测价值受采样时点影响。",
            "Zhang et al. 报告治疗前后耗竭标志物表现不同。",
        ),
        (
            "检测异质性限制跨队列复现。",
            "Chen et al. 发现不同检测批次的效应量存在明显差异。",
        ),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (supports, excerpt))| EvidenceRecord {
        id: format!("{run_id}-evidence-{}", index + 1),
        run_id: run_id.into(),
        paper_id: format!("pmid:demo-{}", index + 1),
        paper_title: format!("PD-1 resistance evidence {}", index + 1),
        authors: match index {
            0 => vec!["Liu Y".into(), "Zhang Q".into()],
            1 => vec!["Zhang L".into(), "Wang H".into()],
            _ => vec!["Chen M".into(), "Xu R".into()],
        },
        genes: match index {
            0 => vec!["B2M".into(), "HLA-A".into()],
            1 => vec!["PDCD1".into(), "TOX".into()],
            _ => vec![],
        },
        findings: vec![supports.into()],
        journal: Some("PaperPilot Demo Journal".into()),
        issn: None,
        impact_factor: None,
        impact_factor_year: None,
        impact_factor_source: None,
        impact_factor_url: None,
        excerpt: excerpt.into(),
        locator: format!("page {}", index + 2),
        evidence_type: "observational".into(),
        confidence: 0.82 + index as f32 * 0.04,
        supports: vec![supports.into()],
    })
    .collect()
}

fn demo_report(run_id: &str, version: u32, evidence: Vec<EvidenceRecord>) -> Report {
    let evidence_ids = evidence
        .iter()
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let recommendations = [
        ("外部队列验证", "在现有独立队列中验证标志物组合。"),
        ("检测流程一致性研究", "量化实验室和批次间变异。"),
        ("前瞻性小样本探索", "预注册终点并收集探索性样本。"),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (title, rationale))| Recommendation {
        id: format!("recommendation-{}", index + 1),
        title: title.into(),
        rationale: rationale.into(),
        hypothesis: "标志物组合可稳定预测免疫治疗响应。".into(),
        minimal_validation: "使用独立队列、盲法评分和预设阈值。".into(),
        resources: vec!["现有队列".into(), "统计支持".into()],
        risks: vec!["队列异质性".into()],
        stop_condition: "数据完整率低于 70% 或主要终点不可评估。".into(),
        evidence_ids: vec![evidence_ids[index].clone()],
    })
    .collect();
    Report {
        contract_version: CONTRACT_VERSION.into(),
        schema_version: "1.1".into(),
        run_id: run_id.into(),
        version,
        title: "PD-1 耐药标志物：证据图谱与下一步".into(),
        summary: "多源证据提示三条主要耐药路径，但检测异质性限制跨队列复现。".into(),
        timeline: vec!["2020–2026：耐药标志物研究逐步转向多模态验证。".into()],
        themes: vec!["抗原呈递".into(), "T 细胞耗竭".into(), "检测异质性".into()],
        claims: vec![
            Claim {
                id: "claim-1".into(),
                statement: "跨队列证据提示，B2M/HLA-A 相关抗原呈递缺陷可能降低肿瘤细胞被 T 细胞识别和清除的概率，从而形成 PD-1 阻断原发耐药的免疫逃逸基础；现有观察性证据尚不能排除肿瘤负荷与克隆组成等混杂因素。".into(),
                evidence_ids: vec![evidence_ids[0].clone()],
            },
            Claim {
                id: "claim-2".into(),
                statement: "治疗前后 PDCD1/TOX 耗竭表型的变化提示，T 细胞功能状态具有时间依赖性，其预测价值可能来自持续抗原刺激下的状态转换，而非固定的基线标志物；需要纵向采样和功能扰动验证这一解释。".into(),
                evidence_ids: vec![evidence_ids[1].clone()],
            },
        ],
        related_datasets: demo_datasets(),
        controversies: vec!["不同检测平台对标志物阈值尚无共识。".into()],
        limitations: vec!["现有证据以回顾性队列为主。".into()],
        gaps: vec!["缺少跨实验室、跨队列的前瞻验证。".into()],
        recommendations,
        evidence,
        references: vec![
            "Liu et al. Demo evidence 1.".into(),
            "Zhang et al. Demo evidence 2.".into(),
            "Chen et al. Demo evidence 3.".into(),
        ],
        disclaimer: "本报告仅供科研用途，不构成临床诊断或治疗建议。".into(),
        created_at: Utc::now(),
    }
}

fn demo_datasets() -> Vec<PublicDataset> {
    vec![
        PublicDataset {
            id: "dataset-demo-bulk".into(),
            accession: "DEMO-GEO-BULK-001".into(),
            title: "独立队列的 bulk RNA-seq 表达谱".into(),
            source: "NCBI GEO（演示）".into(),
            modality: DatasetModality::BulkRna,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(96),
            summary: "病例与对照的 bulk RNA-seq 队列，可用于候选信号的表达复现。".into(),
            data_types: vec!["RNA-seq".into(), "processed counts".into()],
            access: "open".into(),
            url: "https://www.ncbi.nlm.nih.gov/geo/".into(),
        },
        PublicDataset {
            id: "dataset-demo-single-cell".into(),
            accession: "DEMO-CELLXGENE-SC-001".into(),
            title: "目标组织的单细胞转录组图谱".into(),
            source: "CELLxGENE（演示）".into(),
            modality: DatasetModality::SingleCell,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(18),
            summary: "包含主要细胞类型注释的 scRNA-seq 数据，可定位候选信号的细胞来源。".into(),
            data_types: vec!["scRNA-seq".into(), "h5ad".into()],
            access: "open".into(),
            url: "https://cellxgene.cziscience.com/datasets".into(),
        },
        PublicDataset {
            id: "dataset-demo-spatial".into(),
            accession: "DEMO-GEO-SPATIAL-001".into(),
            title: "疾病组织的空间转录组数据".into(),
            source: "NCBI GEO（演示）".into(),
            modality: DatasetModality::Spatial,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(12),
            summary: "空间表达矩阵与组织切片，可用于验证候选通路的组织区域定位。".into(),
            data_types: vec!["spatial transcriptomics".into(), "tissue images".into()],
            access: "open".into(),
            url: "https://www.ncbi.nlm.nih.gov/geo/".into(),
        },
        PublicDataset {
            id: "dataset-demo-atac".into(),
            accession: "DEMO-ENCODE-ATAC-001".into(),
            title: "相关细胞类型的开放染色质图谱".into(),
            source: "ENCODE（演示）".into(),
            modality: DatasetModality::AtacSeq,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(8),
            summary: "标准化 ATAC-seq 峰与信号轨迹，可评估候选调控区域的可及性。".into(),
            data_types: vec!["ATAC-seq".into(), "bigWig".into(), "peaks".into()],
            access: "open".into(),
            url: "https://www.encodeproject.org/".into(),
        },
        PublicDataset {
            id: "dataset-demo-genomics".into(),
            accession: "DEMO-GDC-GENOME-001".into(),
            title: "开放访问的队列基因组变异数据".into(),
            source: "NCI GDC（演示）".into(),
            modality: DatasetModality::Genomics,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(240),
            summary: "包含开放层级的体细胞变异与拷贝数数据，可用于候选基因的基因组验证。".into(),
            data_types: vec!["somatic variants".into(), "copy number".into()],
            access: "open".into(),
            url: "https://portal.gdc.cancer.gov/".into(),
        },
    ]
}
