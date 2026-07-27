use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::crypto::{CryptoBox, CryptoError};

const FILE_PREFIX: &str = "paperpilot-pdf-";
const FILE_SUFFIX: &str = ".enc";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PdfError {
    #[error("the attachment does not have a PDF signature")]
    InvalidSignature,
    #[error("attachment storage failed: {0}")]
    Storage(String),
    #[error(transparent)]
    Crypto(#[from] CryptoError),
}

#[derive(Debug, Clone)]
pub struct SavedAttachment {
    pub id: String,
    pub project_id: String,
    pub original_filename: String,
    pub created_at: DateTime<Utc>,
    pub path: PathBuf,
}

pub struct AttachmentStore {
    root: PathBuf,
    crypto: CryptoBox,
}

impl AttachmentStore {
    pub fn new(root: &Path, key: [u8; 32]) -> Result<Self, PdfError> {
        Ok(Self {
            root: root.to_path_buf(),
            crypto: CryptoBox::new(key),
        })
    }

    pub fn save_pdf(
        &self,
        project_id: &str,
        original_filename: &str,
        contents: &[u8],
        created_at: DateTime<Utc>,
    ) -> Result<SavedAttachment, PdfError> {
        if !contents.starts_with(b"%PDF-") {
            return Err(PdfError::InvalidSignature);
        }

        fs::create_dir_all(&self.root).map_err(storage_error)?;
        let id = Uuid::new_v4().to_string();
        let path = self.root.join(format!(
            "{FILE_PREFIX}{}-{id}{FILE_SUFFIX}",
            created_at.timestamp()
        ));
        let encrypted = self
            .crypto
            .encrypt_with_aad(contents, attachment_aad(project_id, &id).as_bytes())?;
        fs::write(&path, encrypted).map_err(storage_error)?;

        Ok(SavedAttachment {
            id,
            project_id: project_id.to_owned(),
            original_filename: original_filename.to_owned(),
            created_at,
            path,
        })
    }

    pub fn read_pdf(&self, attachment: &SavedAttachment) -> Result<Vec<u8>, PdfError> {
        let encrypted = fs::read(&attachment.path).map_err(storage_error)?;
        self.crypto
            .decrypt_with_aad(
                &encrypted,
                attachment_aad(&attachment.project_id, &attachment.id).as_bytes(),
            )
            .map_err(PdfError::from)
    }

    pub fn cleanup_expired(
        &self,
        now: DateTime<Utc>,
        retention_hours: i64,
    ) -> Result<usize, PdfError> {
        if !self.root.exists() {
            return Ok(0);
        }

        let cutoff = now.timestamp() - retention_hours.max(0) * 60 * 60;
        let mut removed = 0;
        for entry in fs::read_dir(&self.root).map_err(storage_error)? {
            let entry = entry.map_err(storage_error)?;
            let Some(created_at) = managed_file_timestamp(&entry.path()) else {
                continue;
            };
            if created_at < cutoff {
                fs::remove_file(entry.path()).map_err(storage_error)?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

fn attachment_aad(project_id: &str, attachment_id: &str) -> String {
    format!("paperpilot:attachment:{project_id}:{attachment_id}")
}

fn managed_file_timestamp(path: &Path) -> Option<i64> {
    let filename = path.file_name()?.to_str()?;
    let managed = filename
        .strip_prefix(FILE_PREFIX)?
        .strip_suffix(FILE_SUFFIX)?;
    managed.split_once('-')?.0.parse().ok()
}

fn storage_error(error: std::io::Error) -> PdfError {
    PdfError::Storage(error.to_string())
}
