use chrono::Utc;
use thiserror::Error;
use uuid::Uuid;

use crate::{
    CONTRACT_VERSION,
    contracts::{
        Claim, ConversationMessage, EvidenceRecord, MessageAction, MessageResult, Project,
        Recommendation, Report, ResearchBrief, ResearchRun, RunEvent, RunOperation, RunSnapshot,
        RunStatus, validate_report,
    },
    storage::{LocalStore, StorageError},
};

const STAGES: [(&str, &str, &str); 9] = [
    ("structure_question", "问题结构化", "已形成结构化研究问题。"),
    ("search_sources", "多源检索", "已检索固定演示文献。"),
    (
        "deduplicate",
        "标识归一化与去重",
        "已按 PMID、PMCID、DOI 和标题去重。",
    ),
    ("screen", "相关性筛选", "已保留与研究问题相关的文献。"),
    ("parse", "全文解析", "已提取可定位的分页文本。"),
    (
        "create_evidence",
        "证据抽取",
        "已创建不可变 Evidence Record。",
    ),
    ("synthesize", "研究综合", "已形成证据支持的主要结论。"),
    ("recommend", "下一步建议", "已生成恰好三个可检验方案。"),
    ("citation_audit", "引用审计", "主要结论证据覆盖率为 100%。"),
];

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("report validation failed: {0}")]
    Validation(String),
    #[error("run is not ready for this operation")]
    InvalidState,
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

    pub fn create_project(&self, name: &str, description: &str) -> Result<Project, PipelineError> {
        Ok(self.store.create_project(name, description)?)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, PipelineError> {
        Ok(self.store.list_projects()?)
    }

    pub fn delete_project(&self, project_id: &str) -> Result<(), PipelineError> {
        Ok(self.store.delete_project(project_id)?)
    }

    pub fn cancel_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        let run = self.store.get_run(run_id)?;
        Ok(self.store.update_run(
            run_id,
            RunStatus::Cancelled,
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

    pub fn wait_run(&self, run_id: &str) -> Result<ResearchRun, PipelineError> {
        let run = self.store.get_run(run_id)?;
        if run.status != RunStatus::Running {
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
        schema_version: "1.0".into(),
        run_id: run_id.into(),
        version,
        title: "PD-1 耐药标志物：证据图谱与下一步".into(),
        summary: "多源证据提示三条主要耐药路径，但检测异质性限制跨队列复现。".into(),
        timeline: vec!["2020–2026：耐药标志物研究逐步转向多模态验证。".into()],
        themes: vec!["抗原呈递".into(), "T 细胞耗竭".into(), "检测异质性".into()],
        claims: vec![
            Claim {
                id: "claim-1".into(),
                statement: "抗原呈递缺陷与原发耐药稳定相关。".into(),
                evidence_ids: vec![evidence_ids[0].clone()],
            },
            Claim {
                id: "claim-2".into(),
                statement: "耗竭表型的预测价值受采样时点影响。".into(),
                evidence_ids: vec![evidence_ids[1].clone()],
            },
        ],
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
