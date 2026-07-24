pub mod attachments;
pub mod commands;
pub mod contracts;
pub mod crypto;
pub mod key_management;
pub mod pipeline;
pub mod storage;
mod tauri_api;

pub const CONTRACT_VERSION: &str = "1.0";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let key = key_management::load_or_create_master_key(&data_dir)?;
            let service = commands::DesktopService::open(&data_dir, key)?;
            app.manage(service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tauri_api::create_project,
            tauri_api::list_projects,
            tauri_api::start_run,
            tauri_api::cancel_run,
            tauri_api::resume_run,
            tauri_api::send_message,
            tauri_api::get_run_snapshot,
            tauri_api::get_report,
            tauri_api::get_evidence,
            tauri_api::export_report,
            tauri_api::delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("PaperPilot desktop failed to start");
}
