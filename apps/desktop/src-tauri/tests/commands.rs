use paperpilot_desktop::{
    commands::DesktopService,
    contracts::{ExportFormat, ResearchBrief, RunStatus},
};

#[test]
fn desktop_service_exposes_the_local_project_run_report_and_delete_flow() {
    let directory = tempfile::tempdir().unwrap();
    let service = DesktopService::open_for_test(directory.path(), [8_u8; 32]).unwrap();
    let project = service.create_project("本地项目", "不进入云端").unwrap();
    assert_eq!(service.list_projects().unwrap(), vec![project.clone()]);

    let run = service
        .start_run(
            &project.id,
            ResearchBrief {
                question: "验证本地桌面研究流程".into(),
                population: None,
                intervention: None,
                comparison: None,
                outcomes: vec![],
                keywords: vec![],
                date_from: None,
                date_to: None,
                study_types: vec![],
            },
        )
        .unwrap();
    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(
        service.get_run_snapshot(&run.id).unwrap().operations.len(),
        9
    );
    assert_eq!(
        service
            .get_report(&run.id, None)
            .unwrap()
            .recommendations
            .len(),
        3
    );

    let export = service
        .export_report(&run.id, ExportFormat::Markdown)
        .unwrap();
    assert!(export.content.contains("## 进展时间线"));
    assert!(export.content.contains("## 主题版图"));
    assert!(export.content.contains("## 三个下一步方案"));
    assert!(export.content.contains("## 参考文献"));
    assert!(export.content.contains("仅供科研用途"));

    let print_export = service
        .export_report(&run.id, ExportFormat::PrintHtml)
        .unwrap();
    assert!(print_export.content.contains("<h2>主要结论</h2>"));
    assert!(print_export.content.contains("<h2>三个下一步方案</h2>"));
    assert!(print_export.content.contains("<h2>参考文献</h2>"));

    service.delete_project(&project.id).unwrap();
    assert!(service.list_projects().unwrap().is_empty());
}

#[test]
fn queued_runs_emit_each_persisted_stage_before_the_completed_report() {
    let directory = tempfile::tempdir().unwrap();
    let service = DesktopService::open_for_test(directory.path(), [9_u8; 32]).unwrap();
    let project = service.create_project("streaming", "").unwrap();
    let queued = service
        .queue_run(
            &project.id,
            ResearchBrief {
                question: "stream the research stages".into(),
                population: None,
                intervention: None,
                comparison: None,
                outcomes: vec![],
                keywords: vec![],
                date_from: None,
                date_to: None,
                study_types: vec![],
            },
        )
        .unwrap();
    assert_eq!(queued.status, RunStatus::Queued);

    let mut events = Vec::new();
    let completed = service
        .execute_run_with_events(&queued.id, |event| events.push(event))
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
    assert!(events[..9].iter().all(|event| event.operation.is_some()));
    assert_eq!(events[9].status, RunStatus::Completed);
    assert!(events[9].operation.is_none());
}
