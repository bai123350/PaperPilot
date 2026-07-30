use paperpilot_desktop::contracts::{
    EvidenceRecord, Recommendation, Report, RunStatus, validate_report,
};

#[test]
fn run_status_serializes_to_the_persisted_contract_values() {
    let values = [
        RunStatus::Queued,
        RunStatus::Running,
        RunStatus::Waiting,
        RunStatus::Retrying,
        RunStatus::Completed,
        RunStatus::Failed,
        RunStatus::Cancelled,
    ]
    .map(|status| serde_json::to_string(&status).unwrap());

    assert_eq!(
        values,
        [
            "\"queued\"",
            "\"running\"",
            "\"waiting\"",
            "\"retrying\"",
            "\"completed\"",
            "\"failed\"",
            "\"cancelled\"",
        ]
    );
}

#[test]
fn report_requires_exactly_three_recommendations_and_known_evidence() {
    let evidence = EvidenceRecord {
        id: "evidence-1".into(),
        run_id: "run-1".into(),
        paper_id: "pmid:1".into(),
        paper_title: "Paper".into(),
        authors: vec!["Ada Liu".into()],
        genes: vec!["B2M".into()],
        findings: vec!["B2M loss reduced antigen presentation.".into()],
        journal: None,
        issn: None,
        impact_factor: None,
        impact_factor_year: None,
        impact_factor_source: None,
        impact_factor_url: None,
        excerpt: "Excerpt".into(),
        locator: "page 1".into(),
        evidence_type: "observational".into(),
        confidence: 0.9,
        supports: vec!["claim-1".into()],
    };
    let recommendation = Recommendation {
        id: "recommendation-1".into(),
        title: "Validate".into(),
        rationale: "Rationale".into(),
        hypothesis: "Hypothesis".into(),
        minimal_validation: "Validation".into(),
        resources: vec!["Dataset".into()],
        risks: vec!["Bias".into()],
        stop_condition: "Stop".into(),
        evidence_ids: vec!["evidence-1".into()],
    };
    let mut report = Report {
        contract_version: "1.0".into(),
        schema_version: "1.0".into(),
        run_id: "run-1".into(),
        version: 1,
        title: "Report".into(),
        summary: "Summary".into(),
        timeline: vec![],
        themes: vec![],
        claims: vec![],
        controversies: vec![],
        limitations: vec![],
        gaps: vec![],
        recommendations: vec![recommendation.clone(), recommendation.clone()],
        evidence: vec![evidence],
        references: vec![],
        disclaimer: "Research use only.".into(),
        created_at: chrono::Utc::now(),
    };

    assert_eq!(
        validate_report(&report).unwrap_err(),
        "report must contain exactly three recommendations"
    );

    report.recommendations.push(recommendation);
    report.recommendations[0].evidence_ids = vec!["unknown".into()];
    assert_eq!(
        validate_report(&report).unwrap_err(),
        "report references evidence outside the current run"
    );
}
