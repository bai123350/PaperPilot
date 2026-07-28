use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    CONTRACT_VERSION,
    contracts::{
        ConversationMessage, EvidenceRecord, Project, Report, ResearchBrief, ResearchRun,
        RunOperation, RunSnapshot, RunStatus,
    },
    crypto::{CryptoBox, CryptoError},
};

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("encrypted project content is invalid")]
    Crypto(#[from] CryptoError),
    #[error("stored timestamp is invalid")]
    Timestamp,
    #[error("stored text is not UTF-8")]
    Text,
    #[error("database lock is poisoned")]
    Lock,
    #[error("requested local record was not found")]
    NotFound,
    #[error("stored JSON is invalid")]
    Json(#[from] serde_json::Error),
}

pub struct LocalStore {
    connection: Mutex<Connection>,
    crypto: CryptoBox,
}

impl LocalStore {
    pub fn open(path: &Path, key: [u8; 32]) -> Result<Self, StorageError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name_encrypted BLOB NOT NULL,
                description_encrypted BLOB NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                filename_encrypted BLOB NOT NULL,
                object_path TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                stage TEXT,
                progress INTEGER NOT NULL,
                report_version INTEGER NOT NULL,
                brief_encrypted BLOB NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                sequence INTEGER NOT NULL,
                role TEXT NOT NULL,
                payload_encrypted BLOB NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(run_id, sequence)
            );
            CREATE TABLE IF NOT EXISTS operations (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                sequence INTEGER NOT NULL,
                payload_encrypted BLOB NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(run_id, sequence)
            );
            CREATE TABLE IF NOT EXISTS evidence_records (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                payload_encrypted BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reports (
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                version INTEGER NOT NULL,
                payload_encrypted BLOB NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(run_id, version)
            );
            ",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
            crypto: CryptoBox::new(key),
        })
    }

    pub fn create_project(&self, name: &str, description: &str) -> Result<Project, StorageError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let name_encrypted = self
            .crypto
            .encrypt_with_aad(name.as_bytes(), format!("project:{id}:name").as_bytes())?;
        let description_encrypted = self.crypto.encrypt_with_aad(
            description.as_bytes(),
            format!("project:{id}:description").as_bytes(),
        )?;
        self.connection()?.execute(
            "INSERT INTO projects (
                id, name_encrypted, description_encrypted, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                name_encrypted,
                description_encrypted,
                now.to_rfc3339(),
                now.to_rfc3339()
            ],
        )?;
        Ok(Project {
            id,
            name: name.into(),
            description: description.into(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, name_encrypted, description_encrypted, created_at, updated_at
             FROM projects ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        rows.map(|row| {
            let (id, name, description, created_at, updated_at) = row?;
            Ok(Project {
                name: decode(
                    self.crypto
                        .decrypt_with_aad(&name, format!("project:{id}:name").as_bytes())?,
                )?,
                description: decode(self.crypto.decrypt_with_aad(
                    &description,
                    format!("project:{id}:description").as_bytes(),
                )?)?,
                id,
                created_at: parse_timestamp(&created_at)?,
                updated_at: parse_timestamp(&updated_at)?,
            })
        })
        .collect()
    }

    pub fn insert_attachment(
        &self,
        project_id: &str,
        filename: &str,
        object_path: &str,
    ) -> Result<(), StorageError> {
        let id = Uuid::new_v4().to_string();
        let filename = self.crypto.encrypt_with_aad(
            filename.as_bytes(),
            format!("attachment:{id}:filename").as_bytes(),
        )?;
        self.connection()?.execute(
            "INSERT INTO attachments (id, project_id, filename_encrypted, object_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                project_id,
                filename,
                object_path,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn delete_project(&self, project_id: &str) -> Result<(), StorageError> {
        self.connection()?
            .execute("DELETE FROM projects WHERE id = ?1", [project_id])?;
        Ok(())
    }

    pub fn attachment_count(&self) -> Result<u64, StorageError> {
        let count =
            self.connection()?
                .query_row("SELECT COUNT(*) FROM attachments", [], |row| {
                    row.get::<_, u64>(0)
                })?;
        Ok(count)
    }

    pub fn create_run(
        &self,
        project_id: &str,
        brief: &ResearchBrief,
    ) -> Result<ResearchRun, StorageError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let encrypted = self.encrypt_json(&format!("run:{id}:brief"), brief)?;
        self.connection()?.execute(
            "INSERT INTO runs (
                id, project_id, status, stage, progress, report_version, brief_encrypted,
                created_at, updated_at, completed_at
             ) VALUES (?1, ?2, 'queued', NULL, 0, 0, ?3, ?4, ?4, NULL)",
            params![id, project_id, encrypted, now.to_rfc3339()],
        )?;
        self.get_run(&id)
    }

    pub fn get_run(&self, run_id: &str) -> Result<ResearchRun, StorageError> {
        self.connection()?
            .query_row(
                "SELECT id, project_id, status, stage, progress, report_version,
                        created_at, updated_at, completed_at
                 FROM runs WHERE id = ?1",
                [run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, u8>(4)?,
                        row.get::<_, u32>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound,
                other => StorageError::Database(other),
            })
            .and_then(
                |(
                    id,
                    project_id,
                    status,
                    stage,
                    progress,
                    report_version,
                    created_at,
                    updated_at,
                    completed_at,
                )| {
                    Ok(ResearchRun {
                        id,
                        project_id,
                        status: parse_status(&status)?,
                        stage,
                        progress,
                        report_version,
                        created_at: parse_timestamp(&created_at)?,
                        updated_at: parse_timestamp(&updated_at)?,
                        completed_at: completed_at.as_deref().map(parse_timestamp).transpose()?,
                    })
                },
            )
    }

    pub fn get_latest_project_run(
        &self,
        project_id: &str,
    ) -> Result<Option<ResearchRun>, StorageError> {
        let run_id = self
            .connection()?
            .query_row(
                "SELECT id FROM runs
                 WHERE project_id = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        run_id.map(|id| self.get_run(&id)).transpose()
    }

    pub fn list_project_run_snapshots(
        &self,
        project_id: &str,
    ) -> Result<Vec<RunSnapshot>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id FROM runs
             WHERE project_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;
        let run_ids = statement
            .query_map([project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        drop(connection);
        run_ids
            .into_iter()
            .map(|run_id| self.run_snapshot(&run_id))
            .collect()
    }

    pub fn get_brief(&self, run_id: &str) -> Result<ResearchBrief, StorageError> {
        let encrypted = self
            .connection()?
            .query_row(
                "SELECT brief_encrypted FROM runs WHERE id = ?1",
                [run_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound,
                other => StorageError::Database(other),
            })?;
        self.decrypt_json(&format!("run:{run_id}:brief"), &encrypted)
    }

    pub fn update_run(
        &self,
        run_id: &str,
        status: RunStatus,
        stage: Option<&str>,
        progress: u8,
        report_version: u32,
    ) -> Result<ResearchRun, StorageError> {
        let now = Utc::now();
        let completed_at = (status == RunStatus::Completed).then(|| now.to_rfc3339());
        self.connection()?.execute(
            "UPDATE runs SET status = ?2, stage = ?3, progress = ?4, report_version = ?5,
                    updated_at = ?6, completed_at = COALESCE(?7, completed_at)
             WHERE id = ?1",
            params![
                run_id,
                status_name(status),
                stage,
                progress,
                report_version,
                now.to_rfc3339(),
                completed_at
            ],
        )?;
        self.get_run(run_id)
    }

    pub fn save_operation(&self, operation: &RunOperation) -> Result<(), StorageError> {
        let encrypted =
            self.encrypt_json(&format!("operation:{}:payload", operation.id), operation)?;
        self.connection()?.execute(
            "INSERT OR REPLACE INTO operations (id, run_id, sequence, payload_encrypted, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                operation.id,
                operation.run_id,
                operation.sequence,
                encrypted,
                operation.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn list_operations(&self, run_id: &str) -> Result<Vec<RunOperation>, StorageError> {
        self.list_encrypted_rows(
            "SELECT id, payload_encrypted FROM operations WHERE run_id = ?1 ORDER BY sequence",
            run_id,
            "operation",
        )
    }

    pub fn save_message(&self, message: &ConversationMessage) -> Result<(), StorageError> {
        let encrypted = self.encrypt_json(&format!("message:{}:payload", message.id), message)?;
        self.connection()?.execute(
            "INSERT INTO messages (id, run_id, sequence, role, payload_encrypted, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                message.id,
                message.run_id,
                message.sequence,
                message.role,
                encrypted,
                message.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn list_messages(&self, run_id: &str) -> Result<Vec<ConversationMessage>, StorageError> {
        self.list_encrypted_rows(
            "SELECT id, payload_encrypted FROM messages WHERE run_id = ?1 ORDER BY sequence",
            run_id,
            "message",
        )
    }

    pub fn save_evidence(&self, record: &EvidenceRecord) -> Result<(), StorageError> {
        let encrypted = self.encrypt_json(&format!("evidence:{}:payload", record.id), record)?;
        self.connection()?.execute(
            "INSERT INTO evidence_records (id, run_id, payload_encrypted) VALUES (?1, ?2, ?3)",
            params![record.id, record.run_id, encrypted],
        )?;
        Ok(())
    }

    pub fn list_evidence(&self, run_id: &str) -> Result<Vec<EvidenceRecord>, StorageError> {
        self.list_encrypted_rows(
            "SELECT id, payload_encrypted FROM evidence_records WHERE run_id = ?1 ORDER BY id",
            run_id,
            "evidence",
        )
    }

    pub fn get_evidence(
        &self,
        run_id: &str,
        evidence_id: &str,
    ) -> Result<EvidenceRecord, StorageError> {
        let encrypted = self
            .connection()?
            .query_row(
                "SELECT payload_encrypted FROM evidence_records WHERE run_id = ?1 AND id = ?2",
                params![run_id, evidence_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound,
                other => StorageError::Database(other),
            })?;
        self.decrypt_json(
            &format!("evidence:{evidence_id}:payload"),
            encrypted.as_slice(),
        )
    }

    pub fn save_report(&self, report: &Report) -> Result<(), StorageError> {
        let encrypted = self.encrypt_json(
            &format!("report:{}:{}:payload", report.run_id, report.version),
            report,
        )?;
        self.connection()?.execute(
            "INSERT INTO reports (run_id, version, payload_encrypted, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                report.run_id,
                report.version,
                encrypted,
                report.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn get_report(&self, run_id: &str, version: Option<u32>) -> Result<Report, StorageError> {
        let version = match version {
            Some(version) => version,
            None => self
                .connection()?
                .query_row(
                    "SELECT MAX(version) FROM reports WHERE run_id = ?1",
                    [run_id],
                    |row| row.get::<_, Option<u32>>(0),
                )?
                .ok_or(StorageError::NotFound)?,
        };
        let encrypted = self
            .connection()?
            .query_row(
                "SELECT payload_encrypted FROM reports WHERE run_id = ?1 AND version = ?2",
                params![run_id, version],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound,
                other => StorageError::Database(other),
            })?;
        self.decrypt_json(
            &format!("report:{run_id}:{version}:payload"),
            encrypted.as_slice(),
        )
    }

    pub fn run_snapshot(&self, run_id: &str) -> Result<RunSnapshot, StorageError> {
        Ok(RunSnapshot {
            contract_version: CONTRACT_VERSION.into(),
            run: self.get_run(run_id)?,
            brief: self.get_brief(run_id)?,
            messages: self.list_messages(run_id)?,
            operations: self.list_operations(run_id)?,
        })
    }

    pub fn next_timeline_sequence(&self, run_id: &str) -> Result<u64, StorageError> {
        let value = self.connection()?.query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1
             FROM (
                 SELECT sequence FROM messages WHERE run_id = ?1
                 UNION ALL
                 SELECT sequence FROM operations WHERE run_id = ?1
             )",
            [run_id],
            |row| row.get(0),
        )?;
        Ok(value)
    }

    fn list_encrypted_rows<T: serde::de::DeserializeOwned>(
        &self,
        sql: &str,
        run_id: &str,
        kind: &str,
    ) -> Result<Vec<T>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(sql)?;
        let rows = statement.query_map([run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?;
        rows.map(|row| {
            let (id, encrypted) = row?;
            self.decrypt_json(&format!("{kind}:{id}:payload"), &encrypted)
        })
        .collect()
    }

    fn encrypt_json<T: serde::Serialize>(
        &self,
        associated_data: &str,
        value: &T,
    ) -> Result<Vec<u8>, StorageError> {
        Ok(self
            .crypto
            .encrypt_with_aad(&serde_json::to_vec(value)?, associated_data.as_bytes())?)
    }

    fn decrypt_json<T: serde::de::DeserializeOwned>(
        &self,
        associated_data: &str,
        value: &[u8],
    ) -> Result<T, StorageError> {
        let plaintext = self
            .crypto
            .decrypt_with_aad(value, associated_data.as_bytes())?;
        Ok(serde_json::from_slice(&plaintext)?)
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, StorageError> {
        self.connection.lock().map_err(|_| StorageError::Lock)
    }
}

fn decode(value: Vec<u8>) -> Result<String, StorageError> {
    String::from_utf8(value).map_err(|_| StorageError::Text)
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>, StorageError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| StorageError::Timestamp)
}

fn status_name(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "queued",
        RunStatus::Running => "running",
        RunStatus::Waiting => "waiting",
        RunStatus::Retrying => "retrying",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Cancelled => "cancelled",
    }
}

fn parse_status(value: &str) -> Result<RunStatus, StorageError> {
    match value {
        "queued" => Ok(RunStatus::Queued),
        "running" => Ok(RunStatus::Running),
        "waiting" => Ok(RunStatus::Waiting),
        "retrying" => Ok(RunStatus::Retrying),
        "completed" => Ok(RunStatus::Completed),
        "failed" => Ok(RunStatus::Failed),
        "cancelled" => Ok(RunStatus::Cancelled),
        _ => Err(StorageError::Text),
    }
}
