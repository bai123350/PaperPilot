from fastapi.testclient import TestClient

from paperpilot.api.app import create_app
from paperpilot.config import Settings


def build_client(tmp_path) -> TestClient:
    settings = Settings(
        demo_mode=True,
        database_url=f"sqlite:///{tmp_path / 'gateway.db'}",
        storage_path=tmp_path / "uploads",
        auth_secret="desktop-gateway-test-secret",
    )
    app = create_app(settings)
    app.state.database.create_schema()
    return TestClient(app)


def installation_token(client: TestClient) -> str:
    response = client.post(
        "/v1/desktop/installations",
        json={"contract_version": "1.0", "installation_id": "installation-1"},
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def test_gateway_is_installation_scoped_idempotent_and_does_not_create_projects(tmp_path) -> None:
    client = build_client(tmp_path)
    token = installation_token(client)
    request = {
        "contract_version": "1.0",
        "request_id": "request-1",
        "operation": "classify_intent",
        "payload": {"content": "把验证周期限制在 8 周"},
        "allowed_evidence_ids": [],
    }

    first = client.post(
        "/v1/desktop/inference",
        headers={"Authorization": f"Bearer {token}"},
        json=request,
    )
    second = client.post(
        "/v1/desktop/inference",
        headers={"Authorization": f"Bearer {token}"},
        json=request,
    )

    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["result"] == {"action": "revise_report"}

    demo_auth = client.post(
        "/v1/auth/demo",
        json={"email": "gateway-check@example.test", "name": "Gateway Check"},
    ).json()["access_token"]
    projects = client.get(
        "/v1/projects",
        headers={"Authorization": f"Bearer {demo_auth}"},
    )
    assert projects.json() == []


def test_gateway_rejects_missing_token_and_evidence_outside_allowlist(tmp_path) -> None:
    client = build_client(tmp_path)
    request = {
        "contract_version": "1.0",
        "request_id": "request-2",
        "operation": "grounded_reply",
        "payload": {
            "content": "解释这个结论",
            "requested_evidence_ids": ["evidence-other-run"],
        },
        "allowed_evidence_ids": ["evidence-current-run"],
    }

    assert client.post("/v1/desktop/inference", json=request).status_code == 401
    token = installation_token(client)
    response = client.post(
        "/v1/desktop/inference",
        headers={"Authorization": f"Bearer {token}"},
        json=request,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "requested evidence is outside the current run"
