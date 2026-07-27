use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

use crate::CONTRACT_VERSION;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InferenceOperation {
    ClassifyIntent,
    StructureQuestion,
    ExtractEvidence,
    SynthesizeReport,
    GroundedReply,
    ReviseReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InferenceResponse {
    pub contract_version: String,
    pub request_id: String,
    pub operation: InferenceOperation,
    pub result: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TransportRequest {
    pub base_url: String,
    pub path: String,
    pub bearer_token: Option<String>,
    pub body: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum TransportError {
    #[error("gateway transport is temporarily unavailable")]
    Transient,
    #[error("gateway rejected the request with status {0}")]
    Rejected(u16),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum GatewayError {
    #[error("gateway retry budget was exhausted")]
    Waiting,
    #[error("gateway rejected the request with status {0}")]
    Rejected(u16),
    #[error("gateway returned an invalid response")]
    Protocol,
    #[error("installation credential storage is unavailable")]
    Credential,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatewayAttemptStatus {
    Retrying { next_attempt: usize },
    Waiting,
}

pub trait GatewayTransport: Send + Sync {
    fn post(&self, request: TransportRequest) -> Result<Value, TransportError>;
}

pub trait TokenStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, GatewayError>;
    fn set(&self, token: &str) -> Result<(), GatewayError>;
}

#[derive(Clone)]
pub struct UreqTransport {
    agent: ureq::Agent,
}

impl UreqTransport {
    pub fn new(timeout: Duration) -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(timeout))
            .build();
        Self {
            agent: config.into(),
        }
    }
}

impl GatewayTransport for UreqTransport {
    fn post(&self, request: TransportRequest) -> Result<Value, TransportError> {
        let url = format!("{}{}", request.base_url, request.path);
        let mut builder = self.agent.post(&url);
        if let Some(token) = request.bearer_token {
            builder = builder.header("Authorization", &format!("Bearer {token}"));
        }
        let mut response = builder
            .send_json(&request.body)
            .map_err(|error| match error {
                ureq::Error::StatusCode(status) => TransportError::Rejected(status),
                _ => TransportError::Transient,
            })?;
        response
            .body_mut()
            .read_json::<Value>()
            .map_err(|_| TransportError::Transient)
    }
}

#[cfg(windows)]
pub struct CredentialManagerTokenStore {
    installation_id: String,
}

#[cfg(windows)]
impl CredentialManagerTokenStore {
    pub fn new(installation_id: impl Into<String>) -> Self {
        Self {
            installation_id: installation_id.into(),
        }
    }

    fn entry(&self) -> Result<keyring_core::Entry, GatewayError> {
        use keyring_core::api::CredentialStoreApi;

        let store =
            windows_native_keyring_store::Store::new().map_err(|_| GatewayError::Credential)?;
        store
            .build("cn.paperpilot.desktop.gateway", &self.installation_id, None)
            .map_err(|_| GatewayError::Credential)
    }
}

#[cfg(windows)]
impl TokenStore for CredentialManagerTokenStore {
    fn get(&self) -> Result<Option<String>, GatewayError> {
        match self.entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(_) => Err(GatewayError::Credential),
        }
    }

    fn set(&self, token: &str) -> Result<(), GatewayError> {
        self.entry()?
            .set_password(token)
            .map_err(|_| GatewayError::Credential)
    }
}

pub struct GatewayClient<T, S> {
    base_url: String,
    installation_id: String,
    transport: T,
    tokens: S,
    max_attempts: usize,
}

impl<T, S> GatewayClient<T, S>
where
    T: GatewayTransport,
    S: TokenStore,
{
    pub fn new(
        base_url: impl Into<String>,
        installation_id: impl Into<String>,
        transport: T,
        tokens: S,
        max_attempts: usize,
    ) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            installation_id: installation_id.into(),
            transport,
            tokens,
            max_attempts: max_attempts.max(1),
        }
    }

    pub fn infer(
        &self,
        request_id: &str,
        operation: InferenceOperation,
        payload: Value,
        allowed_evidence_ids: &[String],
    ) -> Result<InferenceResponse, GatewayError> {
        self.infer_with_status(request_id, operation, payload, allowed_evidence_ids, |_| {})
    }

    pub fn infer_with_status<F>(
        &self,
        request_id: &str,
        operation: InferenceOperation,
        payload: Value,
        allowed_evidence_ids: &[String],
        mut on_status: F,
    ) -> Result<InferenceResponse, GatewayError>
    where
        F: FnMut(GatewayAttemptStatus),
    {
        let token = self.ensure_installation_token()?;
        let request = TransportRequest {
            base_url: self.base_url.clone(),
            path: "/v1/desktop/inference".into(),
            bearer_token: Some(token),
            body: json!({
                "contract_version": CONTRACT_VERSION,
                "request_id": request_id,
                "operation": operation,
                "payload": payload,
                "allowed_evidence_ids": allowed_evidence_ids,
            }),
        };

        for attempt in 0..self.max_attempts {
            match self.transport.post(request.clone()) {
                Ok(response) => {
                    return serde_json::from_value(response).map_err(|_| GatewayError::Protocol);
                }
                Err(TransportError::Rejected(status)) => {
                    return Err(GatewayError::Rejected(status));
                }
                Err(TransportError::Transient) if attempt + 1 < self.max_attempts => {
                    on_status(GatewayAttemptStatus::Retrying {
                        next_attempt: attempt + 2,
                    });
                    continue;
                }
                Err(TransportError::Transient) => {
                    on_status(GatewayAttemptStatus::Waiting);
                    return Err(GatewayError::Waiting);
                }
            }
        }
        Err(GatewayError::Waiting)
    }

    pub fn authenticate(&self) -> Result<(), GatewayError> {
        self.ensure_installation_token().map(|_| ())
    }

    fn ensure_installation_token(&self) -> Result<String, GatewayError> {
        if let Some(token) = self.tokens.get()? {
            return Ok(token);
        }
        let response = self
            .transport
            .post(TransportRequest {
                base_url: self.base_url.clone(),
                path: "/v1/desktop/installations".into(),
                bearer_token: None,
                body: json!({
                    "contract_version": CONTRACT_VERSION,
                    "installation_id": self.installation_id,
                }),
            })
            .map_err(map_transport_error)?;
        let token = response
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or(GatewayError::Protocol)?
            .to_owned();
        self.tokens.set(&token)?;
        Ok(token)
    }
}

fn map_transport_error(error: TransportError) -> GatewayError {
    match error {
        TransportError::Transient => GatewayError::Waiting,
        TransportError::Rejected(status) => GatewayError::Rejected(status),
    }
}
