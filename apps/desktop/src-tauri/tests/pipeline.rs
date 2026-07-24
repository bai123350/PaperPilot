use paperpilot_desktop::{
    contracts::{MessageAction, ResearchBrief, RunStatus, validate_report},
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
    assert!(snapshot
        .operations
        .iter()
        .all(|operation| operation.status == "completed"));

    let report = engine.get_report(&queued.id, None).unwrap();
    validate_report(&report).unwrap();
    assert_eq!(report.recommendations.len(), 3);
    assert!(report.claims.iter().all(|claim| !claim.evidence_ids.is_empty()));
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
    assert!(engine
        .get_report(&run.id, Some(1))
        .is_ok(), "old report versions remain available");
    assert!(engine
        .get_report(&run.id, Some(2))
        .unwrap()
        .summary
        .contains("8 周"));
}
