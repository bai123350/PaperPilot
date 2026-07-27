use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::Path,
};

use thiserror::Error;
use uuid::Uuid;

const INSTALLATION_ID_FILE: &str = "installation.id";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopRuntimeConfig {
    pub demo_mode: bool,
    pub gateway_url: Option<String>,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("PAPERPILOT_DESKTOP_GATEWAY_URL is required when desktop demo mode is disabled")]
    MissingGatewayUrl,
    #[error("desktop runtime configuration is invalid")]
    InvalidConfiguration,
    #[error("installation identity could not be persisted")]
    Io(#[from] std::io::Error),
}

impl DesktopRuntimeConfig {
    pub fn from_env() -> Result<Self, RuntimeError> {
        Self::from_values(
            std::env::var("PAPERPILOT_DESKTOP_DEMO_MODE")
                .ok()
                .as_deref(),
            std::env::var("PAPERPILOT_DESKTOP_GATEWAY_URL")
                .ok()
                .as_deref(),
        )
    }

    pub fn from_values(
        demo_mode: Option<&str>,
        gateway_url: Option<&str>,
    ) -> Result<Self, RuntimeError> {
        let demo_mode = match demo_mode
            .unwrap_or("true")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "true" | "1" | "yes" => true,
            "false" | "0" | "no" => false,
            _ => return Err(RuntimeError::InvalidConfiguration),
        };
        let gateway_url = gateway_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        if !demo_mode && gateway_url.is_none() {
            return Err(RuntimeError::MissingGatewayUrl);
        }
        Ok(Self {
            demo_mode,
            gateway_url,
        })
    }
}

pub fn load_or_create_installation_id(data_dir: &Path) -> Result<String, RuntimeError> {
    fs::create_dir_all(data_dir)?;
    let path = data_dir.join(INSTALLATION_ID_FILE);
    match fs::read_to_string(&path) {
        Ok(value) => return validate_installation_id(value),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    let installation_id = Uuid::new_v4().to_string();
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            file.write_all(installation_id.as_bytes())?;
            file.sync_all()?;
            Ok(installation_id)
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            validate_installation_id(fs::read_to_string(path)?)
        }
        Err(error) => Err(error.into()),
    }
}

fn validate_installation_id(value: String) -> Result<String, RuntimeError> {
    let value = value.trim();
    Uuid::parse_str(value).map_err(|_| RuntimeError::InvalidConfiguration)?;
    Ok(value.to_owned())
}
