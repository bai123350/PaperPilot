use std::{fs, path::Path};

use thiserror::Error;

use crate::{
    contracts::{
        EvidenceRecord, ExportFormat, ExportResult, MessageResult, Project, Report, ResearchBrief,
        ResearchRun, RunSnapshot,
    },
    pipeline::{PipelineError, ResearchEngine},
    storage::LocalStore,
};

#[derive(Debug, Error)]
pub enum CommandError {
    #[error(transparent)]
    Pipeline(#[from] PipelineError),
    #[error("local application directory is unavailable")]
    Io(#[from] std::io::Error),
    #[error("local database could not be opened")]
    Store(#[from] crate::storage::StorageError),
}

pub struct DesktopService {
    engine: ResearchEngine,
}

impl DesktopService {
    pub fn open(data_dir: &Path, key: [u8; 32]) -> Result<Self, CommandError> {
        Self::open_for_test(data_dir, key)
    }

    pub fn open_for_test(data_dir: &Path, key: [u8; 32]) -> Result<Self, CommandError> {
        fs::create_dir_all(data_dir)?;
        let store = LocalStore::open(&data_dir.join("paperpilot.db"), key)?;
        Ok(Self {
            engine: ResearchEngine::new(store),
        })
    }

    pub fn create_project(&self, name: &str, description: &str) -> Result<Project, CommandError> {
        Ok(self.engine.create_project(name, description)?)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, CommandError> {
        Ok(self.engine.list_projects()?)
    }

    pub fn start_run(
        &self,
        project_id: &str,
        brief: ResearchBrief,
    ) -> Result<ResearchRun, CommandError> {
        let run = self.engine.create_run(project_id, brief)?;
        Ok(self.engine.execute_demo_run(&run.id)?)
    }

    pub fn cancel_run(&self, run_id: &str) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.cancel_run(run_id)?)
    }

    pub fn resume_run(&self, run_id: &str) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.resume_run(run_id)?)
    }

    pub fn send_message(&self, run_id: &str, content: &str) -> Result<MessageResult, CommandError> {
        Ok(self.engine.send_message(run_id, content)?)
    }

    pub fn get_run_snapshot(&self, run_id: &str) -> Result<RunSnapshot, CommandError> {
        Ok(self.engine.get_run_snapshot(run_id)?)
    }

    pub fn get_report(
        &self,
        run_id: &str,
        version: Option<u32>,
    ) -> Result<Report, CommandError> {
        Ok(self.engine.get_report(run_id, version)?)
    }

    pub fn get_evidence(
        &self,
        run_id: &str,
        evidence_id: &str,
    ) -> Result<EvidenceRecord, CommandError> {
        Ok(self.engine.get_evidence(run_id, evidence_id)?)
    }

    pub fn export_report(
        &self,
        run_id: &str,
        format: ExportFormat,
    ) -> Result<ExportResult, CommandError> {
        let report = self.engine.get_report(run_id, None)?;
        let content = match format {
            ExportFormat::Markdown => report_markdown(&report),
            ExportFormat::PrintHtml => report_print_html(&report),
        };
        let extension = match format {
            ExportFormat::Markdown => "md",
            ExportFormat::PrintHtml => "html",
        };
        Ok(ExportResult {
            format,
            suggested_filename: format!("paperpilot-{}.{}", &run_id[..8], extension),
            content,
        })
    }

    pub fn delete_project(&self, project_id: &str) -> Result<(), CommandError> {
        Ok(self.engine.delete_project(project_id)?)
    }
}

fn report_markdown(report: &Report) -> String {
    let claims = report
        .claims
        .iter()
        .map(|claim| format!("- {} [{}]", claim.statement, claim.evidence_ids.join(", ")))
        .collect::<Vec<_>>()
        .join("\n");
    let recommendations = report
        .recommendations
        .iter()
        .enumerate()
        .map(|(index, item)| {
            format!(
                "### {}. {}\n\n- **依据：** {}\n- **可检验假设：** {}\n- **最小验证：** {}\n- **停止条件：** {}",
                index + 1,
                item.title,
                item.rationale,
                item.hypothesis,
                item.minimal_validation,
                item.stop_condition
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "# {}\n\n{}\n\n## 主要结论\n\n{}\n\n## 三个下一步方案\n\n{}\n\n---\n\n{}",
        report.title, report.summary, claims, recommendations, report.disclaimer
    )
}

fn report_print_html(report: &Report) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{}</title><h1>{}</h1><p>{}</p><p>{}</p>",
        report.title, report.title, report.summary, report.disclaimer
    )
}
