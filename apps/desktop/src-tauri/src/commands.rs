use std::{fs, path::Path};

use thiserror::Error;

use crate::{
    contracts::{
        EvidenceRecord, ExportFormat, ExportResult, MessageResult, Project, Report, ResearchBrief,
        ResearchRun, RunEvent, RunSnapshot,
    },
    live_research::LiveResearchBackend,
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
        self.start_run_with_observer(project_id, brief, |_| {})
    }

    pub fn retry_failed_run(&self, run_id: &str) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.retry_failed_run(run_id)?)
    }

    pub fn start_run_with_observer<F>(
        &self,
        project_id: &str,
        brief: ResearchBrief,
        observer: F,
    ) -> Result<ResearchRun, CommandError>
    where
        F: FnMut(RunEvent),
    {
        let run = self.queue_run(project_id, brief)?;
        self.execute_run_with_events(&run.id, observer)
    }

    pub fn queue_run(
        &self,
        project_id: &str,
        brief: ResearchBrief,
    ) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.create_run(project_id, brief)?)
    }

    pub fn execute_run_with_events<F>(
        &self,
        run_id: &str,
        on_event: F,
    ) -> Result<ResearchRun, CommandError>
    where
        F: FnMut(crate::contracts::RunEvent),
    {
        Ok(self.engine.execute_demo_run_with_events(run_id, on_event)?)
    }

    pub fn execute_live_run_with_events<B, F>(
        &self,
        run_id: &str,
        backend: &B,
        on_event: F,
    ) -> Result<ResearchRun, CommandError>
    where
        B: LiveResearchBackend + ?Sized,
        F: FnMut(crate::contracts::RunEvent),
    {
        Ok(self
            .engine
            .execute_live_run_with_events(run_id, backend, on_event)?)
    }

    pub fn execute_run_with_observer<F>(
        &self,
        run_id: &str,
        observer: F,
    ) -> Result<ResearchRun, CommandError>
    where
        F: FnMut(RunEvent),
    {
        self.execute_run_with_events(run_id, observer)
    }

    pub fn fail_run(&self, run_id: &str) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.fail_run(run_id)?)
    }

    pub fn cancel_run(&self, run_id: &str) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.cancel_run(run_id)?)
    }

    pub fn resume_run(&self, run_id: &str) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.resume_run(run_id)?)
    }

    pub fn resume_run_with_observer<F>(
        &self,
        run_id: &str,
        observer: F,
    ) -> Result<ResearchRun, CommandError>
    where
        F: FnMut(RunEvent),
    {
        self.execute_run_with_events(run_id, observer)
    }

    pub fn wait_run(&self, run_id: &str) -> Result<ResearchRun, CommandError> {
        Ok(self.engine.wait_run(run_id)?)
    }

    pub fn send_message(&self, run_id: &str, content: &str) -> Result<MessageResult, CommandError> {
        Ok(self.engine.send_message(run_id, content)?)
    }

    pub fn send_live_message<B: LiveResearchBackend + ?Sized>(
        &self,
        run_id: &str,
        content: &str,
        backend: &B,
    ) -> Result<MessageResult, CommandError> {
        Ok(self.engine.send_live_message(run_id, content, backend)?)
    }

    pub fn get_run_snapshot(&self, run_id: &str) -> Result<RunSnapshot, CommandError> {
        Ok(self.engine.get_run_snapshot(run_id)?)
    }

    pub fn get_report(&self, run_id: &str, version: Option<u32>) -> Result<Report, CommandError> {
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
    let timeline = markdown_list(&report.timeline);
    let themes = markdown_list(&report.themes);
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
                "### {}. {}\n\n- **依据：** {}\n- **可检验假设：** {}\n- **最小验证：** {}\n- **数据与资源：** {}\n- **风险：** {}\n- **停止条件：** {}",
                index + 1,
                item.title,
                item.rationale,
                item.hypothesis,
                item.minimal_validation,
                item.resources.join("、"),
                item.risks.join("、"),
                item.stop_condition
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let references = markdown_list(&report.references);
    format!(
        "# {}\n\n{}\n\n## 进展时间线\n\n{}\n\n## 主题版图\n\n{}\n\n## 主要结论\n\n{}\n\n## 争议与局限\n\n{}\n\n## 研究空白\n\n{}\n\n## 三个下一步方案\n\n{}\n\n## 参考文献\n\n{}\n\n---\n\n{}",
        report.title,
        report.summary,
        timeline,
        themes,
        claims,
        markdown_list(
            &report
                .controversies
                .iter()
                .chain(report.limitations.iter())
                .cloned()
                .collect::<Vec<_>>()
        ),
        markdown_list(&report.gaps),
        recommendations,
        references,
        report.disclaimer
    )
}

fn report_print_html(report: &Report) -> String {
    let claims = report
        .claims
        .iter()
        .map(|claim| {
            format!(
                "<li>{} <small>[{}]</small></li>",
                escape_html(&claim.statement),
                escape_html(&claim.evidence_ids.join(", "))
            )
        })
        .collect::<String>();
    let recommendations = report
        .recommendations
        .iter()
        .enumerate()
        .map(|(index, item)| {
            format!(
                "<article><h3>{}. {}</h3><p>{}</p><dl><dt>可检验假设</dt><dd>{}</dd><dt>最小验证</dt><dd>{}</dd><dt>数据与资源</dt><dd>{}</dd><dt>风险</dt><dd>{}</dd><dt>停止条件</dt><dd>{}</dd></dl></article>",
                index + 1,
                escape_html(&item.title),
                escape_html(&item.rationale),
                escape_html(&item.hypothesis),
                escape_html(&item.minimal_validation),
                escape_html(&item.resources.join("、")),
                escape_html(&item.risks.join("、")),
                escape_html(&item.stop_condition)
            )
        })
        .collect::<String>();
    format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>{}</title><style>body{{max-width:920px;margin:40px auto;font:15px/1.7 system-ui;color:#26342d}}h1,h2{{line-height:1.25}}section{{margin:32px 0}}article{{break-inside:avoid;border:1px solid #d9e0dc;padding:16px;margin:12px 0}}dt{{font-weight:700}}dd{{margin:0 0 8px}}footer{{margin-top:40px;padding-top:20px;border-top:1px solid #d9e0dc;color:#68756e}}</style></head><body><h1>{}</h1><p>{}</p><section><h2>进展时间线</h2>{}</section><section><h2>主题版图</h2>{}</section><section><h2>主要结论</h2><ul>{}</ul></section><section><h2>争议与局限</h2>{}{}</section><section><h2>研究空白</h2>{}</section><section><h2>三个下一步方案</h2>{}</section><section><h2>参考文献</h2>{}</section><footer>{}</footer></body></html>",
        escape_html(&report.title),
        escape_html(&report.title),
        escape_html(&report.summary),
        html_list(&report.timeline),
        html_list(&report.themes),
        claims,
        html_list(&report.controversies),
        html_list(&report.limitations),
        html_list(&report.gaps),
        recommendations,
        html_list(&report.references),
        escape_html(&report.disclaimer)
    )
}

fn markdown_list(items: &[String]) -> String {
    if items.is_empty() {
        return "- 暂无".into();
    }
    items
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn html_list(items: &[String]) -> String {
    if items.is_empty() {
        return "<p>暂无</p>".into();
    }
    format!(
        "<ul>{}</ul>",
        items
            .iter()
            .map(|item| format!("<li>{}</li>", escape_html(item)))
            .collect::<String>()
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
