use chrono::Utc;
use paperpilot_desktop::{
    CONTRACT_VERSION,
    contracts::{
        Claim, EvidenceRecord, MessageAction, Recommendation, Report, ResearchBrief, RunStatus,
        validate_report,
    },
    live_research::{GroundedReply, LiveResearchBackend, LiveResearchError},
    pipeline::ResearchEngine,
    storage::LocalStore,
};

fn brief() -> ResearchBrief {
    ResearchBrief {
        question: "比较 PD-1 耐药标志物，并给出可验证的下一步".into(),
        population: Some("接受免疫治疗的实体瘤患者".into()),
        intervention: None,
        comparison: None,
        outcomes: vec!["治疗响应".into()],
        keywords: vec!["PD-1".into(), "耐药".into()],
        date_from: Some(2020),
        date_to: Some(2026),
        study_types: vec!["cohort".into()],
    }
}

#[test]
fn demo_pipeline_persists_nine_stages_and_an_audited_report() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [3_u8; 32]).unwrap();
    let project = store.create_project("免疫耐药", "").unwrap();
    let engine = ResearchEngine::new(store);

    let queued = engine.create_run(&project.id, brief()).unwrap();
    assert_eq!(queued.status, RunStatus::Queued);
    let completed = engine.execute_demo_run(&queued.id).unwrap();
    assert_eq!(completed.status, RunStatus::Completed);
    assert_eq!(completed.progress, 100);

    let snapshot = engine.get_run_snapshot(&queued.id).unwrap();
    assert_eq!(snapshot.operations.len(), 9);
    assert_eq!(
        snapshot
            .operations
            .iter()
            .map(|operation| operation.sequence)
            .collect::<Vec<_>>(),
        (1..=9).collect::<Vec<_>>()
    );
    assert!(
        snapshot
            .operations
            .iter()
            .all(|operation| operation.status == "completed")
    );
    assert_eq!(snapshot.messages[0].sequence, 10);

    let report = engine.get_report(&queued.id, None).unwrap();
    validate_report(&report).unwrap();
    assert_eq!(report.recommendations.len(), 3);
    assert!(
        report
            .claims
            .iter()
            .all(|claim| !claim.evidence_ids.is_empty())
    );
}

#[test]
fn demo_pipeline_emits_ordered_safe_events_after_each_persisted_stage() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [9_u8; 32]).unwrap();
    let project = store.create_project("免疫耐药", "").unwrap();
    let engine = ResearchEngine::new(store);
    let queued = engine.create_run(&project.id, brief()).unwrap();
    let mut events = Vec::new();

    let completed = engine
        .execute_demo_run_with_observer(&queued.id, |event| events.push(event))
        .unwrap();

    assert_eq!(completed.status, RunStatus::Completed);
    assert_eq!(events.len(), 10);
    assert_eq!(
        events
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>(),
        (1..=10).collect::<Vec<_>>()
    );
    assert!(events[..9].iter().all(|event| {
        event.status == RunStatus::Running
            && event.operation.is_some()
            && event.stage == event.operation.as_ref().map(|item| item.stage.clone())
    }));
    let final_event = events.last().unwrap();
    assert_eq!(final_event.status, RunStatus::Completed);
    assert_eq!(final_event.progress, 100);
    assert!(final_event.operation.is_none());
    assert!(
        events
            .iter()
            .all(|event| !event.safe_summary.contains("比较 PD-1 耐药标志物"))
    );
}

#[test]
fn pipeline_stops_before_the_next_stage_when_cancelled() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [10_u8; 32]).unwrap();
    let project = store.create_project("免疫耐药", "").unwrap();
    let engine = ResearchEngine::new(store);
    let queued = engine.create_run(&project.id, brief()).unwrap();
    let mut observed = 0;

    let cancelled = engine
        .execute_demo_run_with_observer(&queued.id, |_| {
            observed += 1;
            if observed == 1 {
                engine.cancel_run(&queued.id).unwrap();
            }
        })
        .unwrap();

    assert_eq!(cancelled.status, RunStatus::Cancelled);
    assert_eq!(observed, 1);
    assert_eq!(
        engine
            .get_run_snapshot(&queued.id)
            .unwrap()
            .operations
            .len(),
        1
    );
    assert!(engine.get_report(&queued.id, None).is_err());
}

#[test]
fn conversation_only_versions_the_report_for_revision_intent() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [4_u8; 32]).unwrap();
    let project = store.create_project("免疫耐药", "").unwrap();
    let engine = ResearchEngine::new(store);
    let run = engine.create_run(&project.id, brief()).unwrap();
    engine.execute_demo_run(&run.id).unwrap();

    let discussion = engine
        .send_message(&run.id, "为什么优先外部队列验证？")
        .unwrap();
    assert_eq!(discussion.action, MessageAction::Discuss);
    assert_eq!(discussion.report_version, 1);
    assert!(!discussion.report_updated);

    let revision = engine
        .send_message(&run.id, "把验证周期限制在 8 周，并优先使用现有队列")
        .unwrap();
    assert_eq!(revision.action, MessageAction::ReviseReport);
    assert_eq!(revision.report_version, 2);
    assert!(revision.report_updated);
    let snapshot = engine.get_run_snapshot(&run.id).unwrap();
    let timeline_sequences = snapshot
        .operations
        .into_iter()
        .map(|item| item.sequence)
        .chain(snapshot.messages.into_iter().map(|item| item.sequence))
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(timeline_sequences.len(), 14);
    assert!(
        engine.get_report(&run.id, Some(1)).is_ok(),
        "old report versions remain available"
    );
    assert!(
        engine
            .get_report(&run.id, Some(2))
            .unwrap()
            .summary
            .contains("8 周")
    );
}

#[test]
fn waiting_runs_resume_from_the_last_persisted_stage_without_duplicates() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [5_u8; 32]).unwrap();
    let project = store.create_project("resume", "").unwrap();
    let engine = ResearchEngine::new(store);
    let run = engine.create_run(&project.id, brief()).unwrap();

    let interrupted = engine
        .execute_demo_run_with_events(&run.id, |event| {
            if event.sequence == 3 {
                engine.wait_run(&run.id).unwrap();
            }
        })
        .unwrap();
    assert_eq!(interrupted.status, RunStatus::Waiting);
    assert_eq!(
        engine.get_run_snapshot(&run.id).unwrap().operations.len(),
        3
    );

    let mut resumed_sequences = Vec::new();
    let completed = engine
        .execute_demo_run_with_events(&run.id, |event| resumed_sequences.push(event.sequence))
        .unwrap();
    assert_eq!(completed.status, RunStatus::Completed);
    assert_eq!(resumed_sequences, (4..=10).collect::<Vec<_>>());
    assert_eq!(
        engine.get_run_snapshot(&run.id).unwrap().operations.len(),
        9
    );
}

struct FakeLiveBackend;

impl LiveResearchBackend for FakeLiveBackend {
    fn collect_evidence(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        Ok(vec![EvidenceRecord {
            id: format!("{run_id}-evidence-1"),
            run_id: run_id.into(),
            paper_id: "pmid:live-1".into(),
            paper_title: "Retrieved biomedical paper".into(),
            excerpt: "A real retrieved abstract excerpt.".into(),
            locator: "abstract".into(),
            evidence_type: "cohort".into(),
            confidence: 0.91,
            supports: vec![format!("模型已围绕“{}”抽取证据。", brief.question)],
        }])
    }

    fn synthesize_report(
        &self,
        run_id: &str,
        version: u32,
        brief: &ResearchBrief,
        evidence: &[EvidenceRecord],
        revision_request: Option<&str>,
    ) -> Result<Report, LiveResearchError> {
        let evidence_id = evidence[0].id.clone();
        Ok(Report {
            contract_version: CONTRACT_VERSION.into(),
            schema_version: "1.0".into(),
            run_id: run_id.into(),
            version,
            title: format!("模型报告：{}", brief.question),
            summary: revision_request
                .map(|request| format!("模型依据新增约束修订：{request}"))
                .unwrap_or_else(|| "模型综合摘要，不是固定演示内容。".into()),
            timeline: vec!["模型生成的进展时间线".into()],
            themes: vec!["模型生成主题".into()],
            claims: vec![Claim {
                id: "claim-live-1".into(),
                statement: "模型生成且有证据引用的结论。".into(),
                evidence_ids: vec![evidence_id.clone()],
            }],
            controversies: vec!["模型识别的争议".into()],
            limitations: vec!["仅基于已检索摘要".into()],
            gaps: vec!["模型识别的研究空白".into()],
            recommendations: (1..=3)
                .map(|index| Recommendation {
                    id: format!("recommendation-live-{index}"),
                    title: format!("模型方案 {index}"),
                    rationale: "基于允许的证据".into(),
                    hypothesis: "可检验假设".into(),
                    minimal_validation: "最小验证".into(),
                    resources: vec!["数据".into()],
                    risks: vec!["偏倚".into()],
                    stop_condition: "预设停止条件".into(),
                    evidence_ids: vec![evidence_id.clone()],
                })
                .collect(),
            evidence: evidence.to_vec(),
            references: vec!["Retrieved biomedical paper".into()],
            disclaimer: "本报告仅供科研用途，不构成临床诊断或治疗建议。".into(),
            created_at: Utc::now(),
        })
    }

    fn grounded_reply(
        &self,
        _question: &str,
        report: &Report,
    ) -> Result<GroundedReply, LiveResearchError> {
        Ok(GroundedReply {
            content: "这是模型基于当前 Evidence Record 生成的回答。".into(),
            evidence_ids: vec![report.evidence[0].id.clone()],
        })
    }
}

#[test]
fn live_pipeline_uses_the_configured_backend_for_report_and_follow_up() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [11_u8; 32]).unwrap();
    let project = store.create_project("真实模型路径", "").unwrap();
    let engine = ResearchEngine::new(store);
    let run = engine.create_run(&project.id, brief()).unwrap();

    let completed = engine
        .execute_live_run_with_events(&run.id, &FakeLiveBackend, |_| {})
        .unwrap();
    assert_eq!(completed.status, RunStatus::Completed);
    let report = engine.get_report(&run.id, None).unwrap();
    assert!(report.title.starts_with("模型报告："));
    assert_eq!(report.evidence[0].paper_id, "pmid:live-1");
    assert!(!report.summary.contains("三条主要耐药路径"));

    let reply = engine
        .send_live_message(&run.id, "为什么得到这个结论？", &FakeLiveBackend)
        .unwrap();
    assert_eq!(reply.action, MessageAction::Discuss);
    assert_eq!(
        reply.message.content,
        "这是模型基于当前 Evidence Record 生成的回答。"
    );
    assert_eq!(
        reply.message.evidence_ids,
        vec![report.evidence[0].id.clone()]
    );
}

#[test]
fn failed_live_run_retries_as_a_fresh_run_without_reusing_partial_operations() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [12_u8; 32]).unwrap();
    let project = store.create_project("重试研究", "").unwrap();
    let engine = ResearchEngine::new(store);
    let run = engine.create_run(&project.id, brief()).unwrap();
    engine.fail_run(&run.id).unwrap();

    let retry = engine.retry_failed_run(&run.id).unwrap();
    assert_ne!(retry.id, run.id);
    assert_eq!(retry.project_id, project.id);
    assert_eq!(retry.status, RunStatus::Queued);
    assert!(
        engine
            .get_run_snapshot(&retry.id)
            .unwrap()
            .operations
            .is_empty()
    );
}
