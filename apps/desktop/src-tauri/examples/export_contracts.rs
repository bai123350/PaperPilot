use std::{fs, path::PathBuf};

use paperpilot_desktop::contracts::{
    Claim, ConversationMessage, EvidenceRecord, ExportFormat, ExportResult, MessageAction,
    MessageResult, Project, Recommendation, Report, ResearchBrief, ResearchRun, RunEvent,
    RunOperation, RunSnapshot, RunStatus,
};
use ts_rs::TS;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let run_status = RunStatus::decl();
    let declarations = [
        run_status.clone(),
        MessageAction::decl(),
        ExportFormat::decl(),
        ExportResult::decl(),
        ResearchBrief::decl(),
        Project::decl(),
        ResearchRun::decl(),
        ConversationMessage::decl(),
        RunOperation::decl(),
        RunSnapshot::decl(),
        MessageResult::decl(),
        RunEvent::decl(),
        EvidenceRecord::decl(),
        Claim::decl(),
        Recommendation::decl(),
        Report::decl(),
    ];
    let declarations = declarations.map(|declaration| format!("export {declaration}"));
    let content = format!(
        "// Generated from Rust desktop contracts. Do not edit by hand.\n\
         export const RUN_STATUSES = [{}] as const;\n\n{}\n",
        string_variants(&run_status).join(", "),
        declarations.join("\n\n")
    );
    let output = output_path();
    fs::create_dir_all(output.parent().expect("generated contract parent"))?;
    fs::write(&output, content)?;
    println!("generated {}", output.display());
    Ok(())
}

fn string_variants(declaration: &str) -> Vec<String> {
    declaration
        .split('"')
        .skip(1)
        .step_by(2)
        .map(|variant| format!("\"{variant}\""))
        .collect()
}

fn output_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/generated/contracts.ts")
}
