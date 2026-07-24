use tauri::{AppHandle, Emitter, State};

use crate::{
    CONTRACT_VERSION,
    commands::DesktopService,
    contracts::{
        EvidenceRecord, ExportFormat, ExportResult, MessageResult, Project, Report, ResearchBrief,
        ResearchRun, RunEvent, RunSnapshot,
    },
};

type CommandResult<T> = Result<T, String>;

#[tauri::command]
pub fn create_project(
    service: State<'_, DesktopService>,
    name: String,
    description: String,
) -> CommandResult<Project> {
    service
        .create_project(&name, &description)
        .map_err(safe_error)
}

#[tauri::command]
pub fn list_projects(service: State<'_, DesktopService>) -> CommandResult<Vec<Project>> {
    service.list_projects().map_err(safe_error)
}

#[tauri::command]
pub fn start_run(
    app: AppHandle,
    service: State<'_, DesktopService>,
    project_id: String,
    brief: ResearchBrief,
) -> CommandResult<ResearchRun> {
    let run = service.start_run(&project_id, brief).map_err(safe_error)?;
    emit_run(&app, &run, "完整报告已通过引用审计。")?;
    Ok(run)
}

#[tauri::command]
pub fn cancel_run(
    app: AppHandle,
    service: State<'_, DesktopService>,
    run_id: String,
) -> CommandResult<ResearchRun> {
    let run = service.cancel_run(&run_id).map_err(safe_error)?;
    emit_run(&app, &run, "研究运行已取消。")?;
    Ok(run)
}

#[tauri::command]
pub fn resume_run(
    app: AppHandle,
    service: State<'_, DesktopService>,
    run_id: String,
) -> CommandResult<ResearchRun> {
    let run = service.resume_run(&run_id).map_err(safe_error)?;
    emit_run(&app, &run, "研究运行已恢复。")?;
    Ok(run)
}

#[tauri::command]
pub fn send_message(
    service: State<'_, DesktopService>,
    run_id: String,
    content: String,
) -> CommandResult<MessageResult> {
    service.send_message(&run_id, &content).map_err(safe_error)
}

#[tauri::command]
pub fn get_run_snapshot(
    service: State<'_, DesktopService>,
    run_id: String,
) -> CommandResult<RunSnapshot> {
    service.get_run_snapshot(&run_id).map_err(safe_error)
}

#[tauri::command]
pub fn get_report(
    service: State<'_, DesktopService>,
    run_id: String,
    version: Option<u32>,
) -> CommandResult<Report> {
    service.get_report(&run_id, version).map_err(safe_error)
}

#[tauri::command]
pub fn get_evidence(
    service: State<'_, DesktopService>,
    run_id: String,
    evidence_id: String,
) -> CommandResult<EvidenceRecord> {
    service
        .get_evidence(&run_id, &evidence_id)
        .map_err(safe_error)
}

#[tauri::command]
pub fn export_report(
    service: State<'_, DesktopService>,
    run_id: String,
    format: ExportFormat,
) -> CommandResult<ExportResult> {
    service.export_report(&run_id, format).map_err(safe_error)
}

#[tauri::command]
pub fn delete_project(
    service: State<'_, DesktopService>,
    project_id: String,
) -> CommandResult<()> {
    service.delete_project(&project_id).map_err(safe_error)
}

fn emit_run(app: &AppHandle, run: &ResearchRun, summary: &str) -> CommandResult<()> {
    app.emit(
        "paperpilot://run-event",
        RunEvent {
            contract_version: CONTRACT_VERSION.into(),
            run_id: run.id.clone(),
            sequence: 0,
            status: run.status,
            stage: run.stage.clone(),
            progress: run.progress,
            operation: None,
            safe_summary: summary.into(),
        },
    )
    .map_err(|_| "desktop event delivery failed".into())
}

fn safe_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
