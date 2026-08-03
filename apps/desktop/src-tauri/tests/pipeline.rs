use chrono::Utc;
use paperpilot_desktop::{
    CONTRACT_VERSION,
    contracts::{
        Claim, ConversationMessage, DatasetModality, EvidenceRecord, MessageAction, PublicDataset,
        Recommendation, Report, ResearchBrief, RunStatus, validate_report,
    },
    live_research::{
        GroundedReply, LiveResearchBackend, LiveResearchError, LiveResearchTrace, RankedSource,
    },
    pipeline::ResearchEngine,
    storage::LocalStore,
};
use std::sync::Mutex;

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

#[derive(Default)]
struct FakeLiveBackend {
    received_histories: Mutex<Vec<Vec<ConversationMessage>>>,
}

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
            authors: vec!["Ada Liu".into()],
            genes: vec!["B2M".into()],
            findings: vec!["B2M loss was associated with resistance.".into()],
            journal: Some("Example Journal".into()),
            issn: Some("1234-5678".into()),
            impact_factor: None,
            impact_factor_year: None,
            impact_factor_source: None,
            impact_factor_url: None,
            excerpt: "A real retrieved abstract excerpt.".into(),
            locator: "abstract".into(),
            evidence_type: "cohort".into(),
            confidence: 0.91,
            supports: vec![format!("模型已围绕“{}”抽取证据。", brief.question)],
        }])
    }

    fn search_public_datasets(&self, _brief: &ResearchBrief) -> Vec<PublicDataset> {
        vec![PublicDataset {
            id: "dataset-live-1".into(),
            accession: "GSE12345".into(),
            title: "Live single-cell dataset".into(),
            source: "NCBI GEO".into(),
            modality: DatasetModality::SingleCell,
            organism: Some("Homo sapiens".into()),
            sample_count: Some(24),
            summary: "Public validation cohort".into(),
            data_types: vec!["scRNA-seq".into()],
            access: "open".into(),
            url: "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12345".into(),
        }]
    }

    fn collect_evidence_with_trace(
        &self,
        run_id: &str,
        brief: &ResearchBrief,
        on_trace: &mut dyn FnMut(LiveResearchTrace),
    ) -> Result<Vec<EvidenceRecord>, LiveResearchError> {
        on_trace(LiveResearchTrace::SearchQueryBuilt {
            query: "(PD-1) AND (resistance)".into(),
        });
        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: "Europe PMC".into(),
        });
        on_trace(LiveResearchTrace::SourcesRetrieved {
            source: "Europe PMC".into(),
            matched_count: 8,
            batch_count: 2,
            returned_count: 12,
            usable_count: 8,
            unique_count: 7,
            reached_limit: true,
        });
        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: "PubMed".into(),
        });
        on_trace(LiveResearchTrace::SourcesRetrieved {
            source: "PubMed".into(),
            matched_count: 6,
            batch_count: 2,
            returned_count: 10,
            usable_count: 6,
            unique_count: 6,
            reached_limit: false,
        });
        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: "OpenAlex".into(),
        });
        on_trace(LiveResearchTrace::SourcesRetrieved {
            source: "OpenAlex".into(),
            matched_count: 73,
            batch_count: 2,
            returned_count: 9,
            usable_count: 5,
            unique_count: 5,
            reached_limit: false,
        });
        on_trace(LiveResearchTrace::SourceSearchStarted {
            source: "Crossref".into(),
        });
        on_trace(LiveResearchTrace::SourceRetrievalFailed {
            source: "Crossref".into(),
            reason: "测试网络超时".into(),
        });
        on_trace(LiveResearchTrace::ManualSourceSearchAvailable {
            source: "Google Scholar".into(),
            url: "https://scholar.google.com/scholar?q=PD-1".into(),
        });
        on_trace(LiveResearchTrace::SourcesMerged {
            collected_count: 18,
            unique_count: 14,
            candidate_count: 14,
        });
        on_trace(LiveResearchTrace::RankingProgress {
            evaluated_count: 7,
            total_count: 14,
            above_threshold_count: 3,
            ranked: vec![RankedSource {
                source: "Europe PMC / PubMed".into(),
                title: "Retrieved biomedical paper".into(),
                year: "2024".into(),
                score: 18,
                reason: "直接研究目标机制".into(),
                included: true,
            }],
        });
        on_trace(LiveResearchTrace::SourcesRanked {
            evaluated_count: 14,
            above_threshold_count: 3,
            selected: vec![RankedSource {
                source: "Europe PMC / PubMed".into(),
                title: "Retrieved biomedical paper".into(),
                year: "2024".into(),
                score: 18,
                reason: "直接研究目标机制".into(),
                included: true,
            }],
        });
        let evidence = self.collect_evidence(run_id, brief)?;
        on_trace(LiveResearchTrace::EvidenceExtractionProgress {
            extracted_count: evidence.len(),
            total_count: evidence.len(),
        });
        on_trace(LiveResearchTrace::EvidenceExtracted {
            selected_count: evidence.len(),
        });
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
        let evidence_id = evidence[0].id.clone();
        Ok(Report {
            contract_version: CONTRACT_VERSION.into(),
            schema_version: "1.1".into(),
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
            related_datasets: vec![],
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
        history: &[ConversationMessage],
    ) -> Result<GroundedReply, LiveResearchError> {
        self.received_histories
            .lock()
            .unwrap()
            .push(history.to_vec());
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
    let backend = FakeLiveBackend::default();

    let completed = engine
        .execute_live_run_with_events(&run.id, &backend, |_| {})
        .unwrap();
    assert_eq!(completed.status, RunStatus::Completed);
    let report = engine.get_report(&run.id, None).unwrap();
    assert!(report.title.starts_with("模型报告："));
    assert_eq!(report.evidence[0].paper_id, "pmid:live-1");
    assert_eq!(report.related_datasets[0].accession, "GSE12345");
    assert!(!report.summary.contains("三条主要耐药路径"));
    let snapshot = engine.get_run_snapshot(&run.id).unwrap();
    assert_eq!(snapshot.operations.len(), 9);
    assert!(
        snapshot.operations[1]
            .summary
            .contains("Europe PMC：按相关性排序读取 2 批，累计 12 篇")
    );
    assert!(
        snapshot.operations[1]
            .summary
            .contains("PubMed：按相关性排序读取 2 批")
    );
    assert!(
        snapshot.operations[1]
            .summary
            .contains("摘要关键词命中并纳入评分 6 篇")
    );
    assert!(
        snapshot.operations[1]
            .summary
            .contains("OpenAlex：按相关性排序读取 2 批")
    );
    assert!(
        snapshot.operations[1]
            .summary
            .contains("摘要关键词命中并纳入评分 73 篇")
    );
    assert!(!snapshot.operations[1].summary.contains("候选总数"));
    assert!(
        snapshot.operations[1]
            .summary
            .contains("Crossref：检索失败（测试网络超时）")
    );
    assert!(
        snapshot.operations[1]
            .summary
            .contains("Google Scholar：已生成手动补充检索入口")
    );
    assert!(snapshot.operations[2].summary.contains("合并为 14 篇"));
    assert!(snapshot.operations[3].summary.contains("≥1 分的有 3 篇"));
    assert!(
        snapshot.operations[3]
            .summary
            .contains("[18/20][2024][Europe PMC / PubMed]")
    );
    assert!(snapshot.operations[3].summary.contains("直接研究目标机制"));
    assert!(
        snapshot.operations[3]
            .summary
            .contains("逐篇解读并展示全部 14 篇")
    );
    assert!(
        snapshot.operations[5]
            .summary
            .contains("1 条不可变 Evidence Record")
    );
    assert!(snapshot.operations[8].summary.contains("覆盖率 100%"));
    assert!(!snapshot.messages[0].content.contains(&report.summary));

    let reply = engine
        .send_live_message(&run.id, "为什么得到这个结论？", &backend)
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
    let revision = engine
        .send_live_message(&run.id, "请将验证周期限制在 8 周", &backend)
        .unwrap();
    assert_eq!(revision.action, MessageAction::ReviseReport);
    assert_eq!(
        revision.message.content,
        "报告 v2 已生成并保存；旧版本仍保留在本机。"
    );
    assert!(
        !revision
            .message
            .content
            .contains(&engine.get_report(&run.id, Some(2)).unwrap().summary)
    );
    assert_eq!(
        engine
            .get_report(&run.id, Some(2))
            .unwrap()
            .related_datasets[0]
            .accession,
        "GSE12345"
    );
    let histories = backend.received_histories.lock().unwrap();
    assert_eq!(histories.len(), 1);
    assert_eq!(histories[0].len(), 1);
    assert_eq!(histories[0][0].content, brief().question);
    assert!(
        histories[0]
            .iter()
            .all(|message| !message.content.starts_with("报告已生成（"))
    );
}

#[test]
fn live_follow_up_remembers_previous_runs_and_suppresses_repeated_answers() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [14_u8; 32]).unwrap();
    let project = store.create_project("跨运行对话记忆", "").unwrap();
    let engine = ResearchEngine::new(store);
    let backend = FakeLiveBackend::default();

    let first_run = engine.create_run(&project.id, brief()).unwrap();
    engine
        .execute_live_run_with_events(&first_run.id, &backend, |_| {})
        .unwrap();
    engine
        .send_live_message(&first_run.id, "为什么得到这个结论？", &backend)
        .unwrap();

    let mut rerun_brief = brief();
    rerun_brief.question = "从 2015 年开始重新检索 PD-1 耐药标志物".into();
    rerun_brief.date_from = Some(2015);
    let second_run = engine.create_run(&project.id, rerun_brief.clone()).unwrap();
    engine
        .execute_live_run_with_events(&second_run.id, &backend, |_| {})
        .unwrap();
    let repeated = engine
        .send_live_message(&second_run.id, "与上一次相比有什么新发现？", &backend)
        .unwrap();

    assert_eq!(
        repeated.message.content,
        "当前 Evidence Record 没有提供超出前述回答的新信息。如需继续分析，请提出新的比较维度或研究约束。"
    );
    assert_eq!(
        repeated.message.evidence_ids,
        vec![format!("{}-evidence-1", second_run.id)]
    );
    let histories = backend.received_histories.lock().unwrap();
    let rerun_history = histories.last().unwrap();
    assert!(
        rerun_history
            .iter()
            .any(|message| message.content == brief().question)
    );
    assert!(
        rerun_history
            .iter()
            .any(|message| message.content == "为什么得到这个结论？")
    );
    assert!(
        rerun_history
            .iter()
            .any(|message| message.content == "这是模型基于当前 Evidence Record 生成的回答。")
    );
    assert!(
        rerun_history
            .iter()
            .any(|message| message.content == rerun_brief.question)
    );
    assert!(
        rerun_history
            .iter()
            .all(|message| !message.content.starts_with("报告已生成（"))
    );
}

#[test]
fn failed_live_run_retries_as_a_fresh_run_without_reusing_partial_operations() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(&directory.path().join("paperpilot.db"), [12_u8; 32]).unwrap();
    let project = store.create_project("重试研究", "").unwrap();
    let engine = ResearchEngine::new(store);
    let run = engine.create_run(&project.id, brief()).unwrap();
    engine
        .fail_run_with_reason(&run.id, "研究运行失败：模型服务暂时不可用。")
        .unwrap();
    assert!(
        engine
            .get_run_snapshot(&run.id)
            .unwrap()
            .messages
            .iter()
            .any(|message| message.content == "研究运行失败：模型服务暂时不可用。")
    );

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
