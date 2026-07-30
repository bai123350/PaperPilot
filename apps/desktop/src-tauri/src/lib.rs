pub mod attachments;
pub mod cancellation;
pub mod commands;
mod conclusion_skills;
pub mod contracts;
pub mod crypto;
pub mod gateway;
pub mod impact_factor;
pub mod key_management;
pub mod live_research;
pub mod pdf_parser;
pub mod pipeline;
pub mod provider_settings;
pub mod runtime;
pub mod storage;
mod tauri_api;

pub const CONTRACT_VERSION: &str = "1.0";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let key = key_management::load_or_create_master_key(&data_dir)?;
            let service = commands::DesktopService::open(&data_dir, key)?;
            app.manage(service);
            app.manage(provider_settings::ModelSettingsStore::new(&data_dir));
            let runtime = runtime::DesktopRuntimeConfig::from_env()?;
            #[cfg(windows)]
            if !runtime.demo_mode {
                use std::{sync::Arc, time::Duration};

                let installation_id = runtime::load_or_create_installation_id(&data_dir)?;
                let gateway = Arc::new(gateway::GatewayClient::new(
                    runtime
                        .gateway_url
                        .expect("live desktop mode requires a gateway URL"),
                    installation_id.clone(),
                    gateway::UreqTransport::new(Duration::from_secs(30)),
                    gateway::CredentialManagerTokenStore::new(installation_id),
                    3,
                ));
                let authentication = gateway.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = authentication.authenticate();
                });
                app.manage(gateway);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tauri_api::create_project,
            tauri_api::list_projects,
            tauri_api::get_latest_project_run,
            tauri_api::list_project_run_snapshots,
            tauri_api::get_model_settings,
            tauri_api::save_model_settings,
            tauri_api::start_run,
            tauri_api::retry_run,
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
