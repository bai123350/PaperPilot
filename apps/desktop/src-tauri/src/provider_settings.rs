use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const CREDENTIAL_SERVICE: &str = "cn.paperpilot.desktop.model";
const CREDENTIAL_USER: &str = "provider-api-key";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettingsInput {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettings {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub configured: bool,
    pub api_key_hint: Option<String>,
}

pub struct ModelClientConfig {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ModelSettingsMetadata {
    provider: String,
    model: String,
    base_url: String,
}

#[derive(Debug, Error)]
pub enum ModelSettingsError {
    #[error("model settings could not be read")]
    Read,
    #[error("model settings could not be saved")]
    Write,
    #[error("model provider is not supported")]
    Provider,
    #[error("model name is required")]
    Model,
    #[error("model API endpoint must use HTTPS or local HTTP")]
    Endpoint,
    #[error("an API key is required for the first setup")]
    ApiKey,
    #[error("Windows Credential Manager is unavailable")]
    Credential,
}

pub struct ModelSettingsStore {
    metadata_path: PathBuf,
}

impl ModelSettingsStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            metadata_path: data_dir.join("model-settings.json"),
        }
    }

    pub fn get(&self) -> Result<Option<ModelSettings>, ModelSettingsError> {
        if !self.metadata_path.exists() {
            return Ok(None);
        }
        let metadata: ModelSettingsMetadata = serde_json::from_slice(
            &fs::read(&self.metadata_path).map_err(|_| ModelSettingsError::Read)?,
        )
        .map_err(|_| ModelSettingsError::Read)?;
        let api_key = read_api_key()?;
        Ok(Some(ModelSettings {
            provider: metadata.provider,
            model: metadata.model,
            base_url: metadata.base_url,
            configured: api_key.is_some(),
            api_key_hint: api_key.as_deref().map(mask_api_key),
        }))
    }

    pub fn save(&self, input: ModelSettingsInput) -> Result<ModelSettings, ModelSettingsError> {
        validate(&input)?;
        let existing_key = read_api_key()?;
        let existing_provider = self.read_metadata()?.map(|metadata| metadata.provider);
        let next_key = if input.api_key.trim().is_empty() {
            if existing_provider.as_deref() != Some(input.provider.as_str()) {
                return Err(ModelSettingsError::ApiKey);
            }
            existing_key.ok_or(ModelSettingsError::ApiKey)?
        } else {
            input.api_key.trim().to_owned()
        };
        save_api_key(&next_key)?;

        let metadata = ModelSettingsMetadata {
            provider: input.provider,
            model: input.model.trim().to_owned(),
            base_url: input.base_url.trim().trim_end_matches('/').to_owned(),
        };
        let temporary = self.metadata_path.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec(&metadata).map_err(|_| ModelSettingsError::Write)?,
        )
        .map_err(|_| ModelSettingsError::Write)?;
        fs::rename(temporary, &self.metadata_path).map_err(|_| ModelSettingsError::Write)?;

        Ok(ModelSettings {
            provider: metadata.provider,
            model: metadata.model,
            base_url: metadata.base_url,
            configured: true,
            api_key_hint: Some(mask_api_key(&next_key)),
        })
    }

    pub fn client_config(&self) -> Result<ModelClientConfig, ModelSettingsError> {
        let metadata = self.read_metadata()?.ok_or(ModelSettingsError::ApiKey)?;
        let api_key = read_api_key()?.ok_or(ModelSettingsError::ApiKey)?;
        Ok(ModelClientConfig {
            provider: metadata.provider,
            model: metadata.model,
            base_url: metadata.base_url,
            api_key,
        })
    }

    fn read_metadata(&self) -> Result<Option<ModelSettingsMetadata>, ModelSettingsError> {
        if !self.metadata_path.exists() {
            return Ok(None);
        }
        serde_json::from_slice(
            &fs::read(&self.metadata_path).map_err(|_| ModelSettingsError::Read)?,
        )
        .map(Some)
        .map_err(|_| ModelSettingsError::Read)
    }
}

fn validate(input: &ModelSettingsInput) -> Result<(), ModelSettingsError> {
    if !matches!(
        input.provider.as_str(),
        "deepseek" | "openai" | "qwen" | "custom"
    ) {
        return Err(ModelSettingsError::Provider);
    }
    if input.model.trim().is_empty() {
        return Err(ModelSettingsError::Model);
    }
    if !allowed_endpoint(input.base_url.trim()) {
        return Err(ModelSettingsError::Endpoint);
    }
    Ok(())
}

fn allowed_endpoint(endpoint: &str) -> bool {
    if endpoint.starts_with("https://") {
        return endpoint.len() > "https://".len();
    }
    let Some(authority) = endpoint
        .strip_prefix("http://")
        .and_then(|value| value.split('/').next())
    else {
        return false;
    };
    authority == "localhost"
        || authority.starts_with("localhost:")
        || authority == "127.0.0.1"
        || authority.starts_with("127.0.0.1:")
        || authority == "[::1]"
        || authority.starts_with("[::1]:")
}

fn mask_api_key(api_key: &str) -> String {
    if api_key.chars().count() <= 4 {
        return "••••".into();
    }
    let suffix = api_key
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("••••{suffix}")
}

#[cfg(windows)]
fn credential_entry() -> Result<keyring_core::Entry, ModelSettingsError> {
    use keyring_core::api::CredentialStoreApi;

    let store =
        windows_native_keyring_store::Store::new().map_err(|_| ModelSettingsError::Credential)?;
    store
        .build(CREDENTIAL_SERVICE, CREDENTIAL_USER, None)
        .map_err(|_| ModelSettingsError::Credential)
}

#[cfg(windows)]
fn read_api_key() -> Result<Option<String>, ModelSettingsError> {
    match credential_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(_) => Err(ModelSettingsError::Credential),
    }
}

#[cfg(windows)]
fn save_api_key(api_key: &str) -> Result<(), ModelSettingsError> {
    credential_entry()?
        .set_password(api_key)
        .map_err(|_| ModelSettingsError::Credential)
}

#[cfg(not(windows))]
fn read_api_key() -> Result<Option<String>, ModelSettingsError> {
    Err(ModelSettingsError::Credential)
}

#[cfg(not(windows))]
fn save_api_key(_api_key: &str) -> Result<(), ModelSettingsError> {
    Err(ModelSettingsError::Credential)
}

#[cfg(test)]
mod tests {
    use super::{ModelSettingsInput, allowed_endpoint, mask_api_key, validate};

    #[test]
    fn validates_provider_model_and_safe_endpoint() {
        let input = ModelSettingsInput {
            provider: "deepseek".into(),
            model: "deepseek-chat".into(),
            base_url: "https://api.deepseek.com".into(),
            api_key: "secret".into(),
        };
        assert!(validate(&input).is_ok());
        assert!(allowed_endpoint("http://localhost:11434/v1"));
        assert!(!allowed_endpoint("http://provider.example/v1"));
    }

    #[test]
    fn only_exposes_a_short_key_hint() {
        assert_eq!(mask_api_key("sk-example-1234"), "••••1234");
        assert_eq!(mask_api_key("tiny"), "••••");
    }
}
