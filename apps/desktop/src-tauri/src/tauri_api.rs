use tauri::{AppHandle, Emitter, Manager, State};

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
    let run = service.queue_run(&project_id, brief).map_err(safe_error)?;
    emit_run(&app, &run, 0, "研究运行已进入本地队列。")?;
    spawn_run(app, run.id.clone());
    Ok(run)
}

#[tauri::command]
pub fn cancel_run(
    app: AppHandle,
    service: State<'_, DesktopService>,
    run_id: String,
) -> CommandResult<ResearchRun> {
    let run = service.cancel_run(&run_id).map_err(safe_error)?;
    let sequence = service
        .get_run_snapshot(&run_id)
        .map_err(safe_error)?
        .operations
        .last()
        .map_or(1, |operation| operation.sequence + 1);
    emit_run(&app, &run, sequence, "研究运行已取消。")?;
    Ok(run)
}

#[tauri::command]
pub fn resume_run(
    app: AppHandle,
    service: State<'_, DesktopService>,
    run_id: String,
) -> CommandResult<ResearchRun> {
    let run = service.get_run_snapshot(&run_id).map_err(safe_error)?.run;
    if !matches!(
        run.status,
        crate::contracts::RunStatus::Waiting | crate::contracts::RunStatus::Retrying
    ) {
        return Err("run is not waiting or retrying".into());
    }
    spawn_run(app, run.id.clone());
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
pub fn delete_project(service: State<'_, DesktopService>, project_id: String) -> CommandResult<()> {
    service.delete_project(&project_id).map_err(safe_error)
}

fn spawn_run(app: AppHandle, run_id: String) {
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        let service = app.state::<DesktopService>();
        let result = service.execute_run_with_events(&run_id, |event| {
            let _ = emitter.emit("paperpilot://run-event", event);
        });
        if result.is_err() {
            let sequence = service
                .get_run_snapshot(&run_id)
                .ok()
                .and_then(|snapshot| snapshot.operations.last().map(|item| item.sequence + 1))
                .unwrap_or(1);
            if let Ok(failed) = service.fail_run(&run_id) {
                let _ = emit_run(
                    &app,
                    &failed,
                    sequence,
                    "本地研究运行失败，可检查设置后重试。",
                );
            }
        }
    });
}

fn emit_run(app: &AppHandle, run: &ResearchRun, sequence: u64, summary: &str) -> CommandResult<()> {
    app.emit(
        "paperpilot://run-event",
        RunEvent {
            contract_version: CONTRACT_VERSION.into(),
            run_id: run.id.clone(),
            sequence,
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
