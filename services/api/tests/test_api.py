from pathlib import Path

from fastapi.testclient import TestClient

from paperpilot.api.app import create_app
from paperpilot.config import Settings


def build_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'paperpilot.db'}",
        storage_path=tmp_path / "uploads",
        demo_mode=True,
        task_always_eager=True,
        auth_secret="test-secret-that-is-long-enough",
    )
    return TestClient(create_app(settings))


def login(client: TestClient, email: str = "researcher@example.com") -> dict[str, str]:
    response = client.post("/v1/auth/demo", json={"email": email, "name": "Researcher"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_project_run_report_and_evidence_flow(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project_response = client.post(
            "/v1/projects",
            headers=headers,
            json={"name": "Biomarker landscape", "description": "Private translational project"},
        )
        assert project_response.status_code == 201
        project_id = project_response.json()["id"]

        run_response = client.post(
            f"/v1/projects/{project_id}/runs",
            headers=headers,
            json={
                "question": "What is the evidence for circulating biomarkers in treatment response?",
                "population": "Adults receiving systemic therapy",
                "outcomes": ["Objective response"],
            },
        )
        assert run_response.status_code == 202
        run = run_response.json()
        assert run["status"] == "completed"
        assert run["stage"] == "auditing"

        report_response = client.get(f"/v1/runs/{run['id']}/report", headers=headers)
        assert report_response.status_code == 200
        report = report_response.json()
        assert report["schema_version"] == "1.0"
        assert len(report["recommendations"]) == 3

        evidence_response = client.get(f"/v1/runs/{run['id']}/evidence", headers=headers)
        assert evidence_response.status_code == 200
        assert evidence_response.json()[0]["excerpt"]


def test_projects_are_isolated_by_authenticated_user(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        owner = login(client, "owner@example.com")
        stranger = login(client, "stranger@example.com")
        project = client.post("/v1/projects", headers=owner, json={"name": "Private project"}).json()

        assert client.get(f"/v1/projects/{project['id']}", headers=stranger).status_code == 404


def test_deleting_project_removes_runs_and_report(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post("/v1/projects", headers=headers, json={"name": "Disposable"}).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "What evidence supports microbiome biomarkers in colorectal cancer?"},
        ).json()

        assert client.delete(f"/v1/projects/{project['id']}", headers=headers).status_code == 204
        assert client.get(f"/v1/runs/{run['id']}/report", headers=headers).status_code == 404


def test_health_endpoint_does_not_require_authentication(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "paperpilot-api"}


def test_research_assistant_uses_current_brief_and_requires_authentication(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        payload = {
            "contract_version": "1.0",
            "brief": {
                "question": "循环肿瘤 DNA 能否预测晚期结直肠癌的治疗响应？",
            },
            "messages": [{"role": "user", "content": "这个研究问题还缺什么？"}],
        }
        assert client.post("/v1/research-assistant/messages", json=payload).status_code == 401

        response = client.post(
            "/v1/research-assistant/messages",
            headers=login(client),
            json=payload,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["contract_version"] == "1.0"
        assert body["message"]["role"] == "assistant"
        assert "研究人群" in body["message"]["content"]


def test_local_auth_can_be_used_with_live_model_mode(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'paperpilot.db'}",
        storage_path=tmp_path / "uploads",
        demo_mode=False,
        local_auth_enabled=True,
        deepseek_api_key="secret",
        task_always_eager=True,
        auth_secret="test-secret-that-is-long-enough",
    )
    with TestClient(create_app(settings)) as client:
        assert login(client)["Authorization"].startswith("Bearer ")


def test_signed_upload_accepts_only_pdf_content(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post("/v1/projects", headers=headers, json={"name": "Private upload"}).json()
        ticket = client.post(
            f"/v1/projects/{project['id']}/uploads/presign",
            headers=headers,
            json={"filename": "unpublished.pdf", "content_type": "application/pdf", "size": 64},
        )
        assert ticket.status_code == 200

        rejected = client.put(
            ticket.json()["upload_url"],
            content=b"not a pdf",
            headers={"Content-Type": "application/pdf"},
        )
        assert rejected.status_code == 415

        accepted = client.put(
            ticket.json()["upload_url"],
            content=b"%PDF-1.7 private unpublished material",
            headers={"Content-Type": "application/pdf"},
        )
        assert accepted.status_code == 201
        assert accepted.json()["object_key"].startswith(f"{project['id']}/") is False


def test_upload_ticket_rejects_oversized_material(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post("/v1/projects", headers=headers, json={"name": "Large upload"}).json()
        response = client.post(
            f"/v1/projects/{project['id']}/uploads/presign",
            headers=headers,
            json={
                "filename": "large.pdf",
                "content_type": "application/pdf",
                "size": 51 * 1024 * 1024,
            },
        )
        assert response.status_code == 422


def test_report_can_be_exported_as_evidence_linked_markdown(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post("/v1/projects", headers=headers, json={"name": "Exportable"}).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "What evidence supports external validation of response biomarkers?"},
        ).json()

        response = client.get(f"/v1/runs/{run['id']}/report.md", headers=headers)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/markdown")
        assert "## 主要结论" in response.text
        assert "PMID: 39000001" in response.text
        assert "停止条件" in response.text
