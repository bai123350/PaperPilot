use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use paperpilot_desktop::gateway::{
    GatewayAttemptStatus, GatewayClient, GatewayError, GatewayTransport, InferenceOperation,
    TokenStore, TransportError, TransportRequest,
};
use serde_json::{Value, json};

#[derive(Clone, Default)]
struct MemoryTokenStore(Arc<Mutex<Option<String>>>);

impl TokenStore for MemoryTokenStore {
    fn get(&self) -> Result<Option<String>, GatewayError> {
        Ok(self.0.lock().unwrap().clone())
    }

    fn set(&self, token: &str) -> Result<(), GatewayError> {
        *self.0.lock().unwrap() = Some(token.to_owned());
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeTransport {
    requests: Arc<Mutex<Vec<TransportRequest>>>,
    responses: Arc<Mutex<VecDeque<Result<Value, TransportError>>>>,
}

impl GatewayTransport for FakeTransport {
    fn post(&self, request: TransportRequest) -> Result<Value, TransportError> {
        self.requests.lock().unwrap().push(request);
        self.responses.lock().unwrap().pop_front().unwrap()
    }
}

#[test]
fn installation_token_is_saved_and_inference_is_minimal_and_idempotent() {
    let transport = FakeTransport::default();
    transport.responses.lock().unwrap().extend([
        Ok(json!({"contract_version": "1.0", "access_token": "credential-token"})),
        Ok(json!({
            "contract_version": "1.0",
            "request_id": "request-1",
            "operation": "classify_intent",
            "result": {"action": "discuss"}
        })),
    ]);
    let tokens = MemoryTokenStore::default();
    let client = GatewayClient::new(
        "https://gateway.example",
        "installation-1",
        transport.clone(),
        tokens.clone(),
        2,
    );

    let response = client
        .infer(
            "request-1",
            InferenceOperation::ClassifyIntent,
            json!({"content": "why this conclusion"}),
            &[],
        )
        .unwrap();
    assert_eq!(response.result, json!({"action": "discuss"}));
    assert_eq!(tokens.get().unwrap().as_deref(), Some("credential-token"));

    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].path, "/v1/desktop/installations");
    assert_eq!(requests[0].bearer_token, None);
    assert_eq!(requests[1].path, "/v1/desktop/inference");
    assert_eq!(
        requests[1].bearer_token.as_deref(),
        Some("credential-token")
    );
    assert_eq!(requests[1].body["request_id"], "request-1");
    assert_eq!(requests[1].body["allowed_evidence_ids"], json!([]));
}

#[test]
fn transient_failures_retry_the_same_request_id_then_become_waiting() {
    let transport = FakeTransport::default();
    transport.responses.lock().unwrap().extend([
        Err(TransportError::Transient),
        Err(TransportError::Transient),
    ]);
    let tokens = MemoryTokenStore::default();
    tokens.set("existing-token").unwrap();
    let client = GatewayClient::new(
        "https://gateway.example",
        "installation-1",
        transport.clone(),
        tokens,
        2,
    );

    let mut statuses = Vec::new();
    let result = client.infer_with_status(
        "request-retry",
        InferenceOperation::GroundedReply,
        json!({"content": "explain", "requested_evidence_ids": ["evidence-1"]}),
        &["evidence-1".into()],
        |status| statuses.push(status),
    );
    assert_eq!(result, Err(GatewayError::Waiting));
    assert_eq!(
        statuses,
        vec![
            GatewayAttemptStatus::Retrying { next_attempt: 2 },
            GatewayAttemptStatus::Waiting,
        ]
    );

    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests.iter().all(|request| {
        request.path == "/v1/desktop/inference" && request.body["request_id"] == "request-retry"
    }));
}
