from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from paperpilot.api.app import create_app
from paperpilot.config import Settings
from paperpilot.database import RunEntity, RunOperationEntity, UserEntity


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


def start_run(client: TestClient, headers: dict[str, str], run_id: str) -> dict:
    response = client.post(f"/v1/runs/{run_id}/start", headers=headers)
    assert response.status_code == 202
    return response.json()


def test_model_api_key_is_encrypted_scoped_and_never_returned(tmp_path: Path) -> None:
    database_path = tmp_path / "paperpilot.db"
    with build_client(tmp_path) as client:
        owner = login(client, "owner@example.com")
        other = login(client, "other@example.com")

        assert client.get("/v1/model-settings", headers=owner).json()["configured"] is False
        saved = client.put(
            "/v1/model-settings",
            headers=owner,
            json={
                "provider": "qwen",
                "model": "qwen-plus",
                "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "api_key": "qwen-secret-value",
            },
        )
        assert saved.status_code == 200
        assert saved.json() == {
            "provider": "qwen",
            "model": "qwen-plus",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "configured": True,
            "api_key_hint": "••••alue",
        }
        assert "qwen-secret-value" not in saved.text
        with client.app.state.database.session() as session:
            owner_entity = session.scalar(
                select(UserEntity).where(UserEntity.email == "owner@example.com")
            )
            resolved = client.app.state.model_settings_store.resolve(
                session, owner_entity.id
            )
            assert resolved.api_key == "qwen-secret-value"
            assert resolved.provider == "qwen"
        assert client.get("/v1/model-settings", headers=other).json()["configured"] is False

        preserved = client.put(
            "/v1/model-settings",
            headers=owner,
            json={
                "provider": "qwen",
                "model": "qwen-max",
                "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "api_key": "",
            },
        )
        assert preserved.status_code == 200
        assert preserved.json()["api_key_hint"] == "••••alue"

        rejected = client.put(
            "/v1/model-settings",
            headers=owner,
            json={
                "provider": "openai",
                "model": "gpt-5-mini",
                "base_url": "https://api.openai.com/v1",
                "api_key": "",
            },
        )
        assert rejected.status_code == 422

    assert b"qwen-secret-value" not in database_path.read_bytes()


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
        assert run["status"] == "queued"
        run = start_run(client, headers, run["id"])
        assert run["status"] == "completed"
        assert run["stage"] == "auditing"

        report_response = client.get(f"/v1/runs/{run['id']}/report", headers=headers)
        assert report_response.status_code == 200
        report = report_response.json()
        assert report["schema_version"] == "1.1"
        assert len(report["recommendations"]) == 3
        assert len(report["related_datasets"]) == 5
        assert {item["modality"] for item in report["related_datasets"]} == {
            "bulk_rna",
            "single_cell",
            "spatial",
            "atac_seq",
            "genomics",
        }

        evidence_response = client.get(f"/v1/runs/{run['id']}/evidence", headers=headers)
        assert evidence_response.status_code == 200
        assert evidence_response.json()[0]["excerpt"]


def test_start_run_returns_the_persisted_failed_state(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post(
            "/v1/projects", headers=headers, json={"name": "Failure handling"}
        ).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "What evidence supports robust external biomarker validation?"},
        ).json()

        def fail_after_persisting(run_id: str) -> None:
            with client.app.state.database.session() as session:
                stored = session.get(RunEntity, run_id)
                stored.status = "failed"
                stored.error = "Research run failed"
            raise RuntimeError("connector unavailable")

        client.app.state.run_service.execute = fail_after_persisting
        response = client.post(f"/v1/runs/{run['id']}/start", headers=headers)

        assert response.status_code == 202
        assert response.json()["status"] == "failed"
        assert response.json()["error"] == "Research run failed"


def test_create_run_accepts_a_concise_research_question(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post(
            "/v1/projects", headers=headers, json={"name": "Concise question"}
        ).json()

        response = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "青光眼研究"},
        )

        assert response.status_code == 202
        assert response.json()["status"] == "queued"


def test_run_conversation_persists_and_revises_report_with_current_evidence(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post(
            "/v1/projects", headers=headers, json={"name": "Conversation project"}
        ).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "What evidence supports external validation of response biomarkers?"},
        ).json()
        run = start_run(client, headers, run["id"])

        bootstrap = client.post(
            f"/v1/runs/{run['id']}/conversation/bootstrap",
            headers=headers,
            json={
                "messages": [
                    {"role": "assistant", "content": "我们先明确研究边界。"},
                    {"role": "user", "content": "重点关注外部验证。"},
                ]
            },
        )
        assert bootstrap.status_code == 200
        assert len(bootstrap.json()["messages"]) == 2

        revision = client.post(
            f"/v1/runs/{run['id']}/conversation/messages",
            headers=headers,
            json={"content": "请补充局限性并完善报告。", "action": "revise_report"},
        )
        assert revision.status_code == 200
        assert revision.json()["report_updated"] is True
        assert revision.json()["report_version"] == 2
        assert revision.json()["message"]["evidence_ids"]

        conversation = client.get(
            f"/v1/runs/{run['id']}/conversation", headers=headers
        ).json()
        assert [item["role"] for item in conversation["messages"]][-2:] == [
            "user",
            "assistant",
        ]
        assert conversation["report_version"] == 2
        revised_report = client.get(f"/v1/runs/{run['id']}/report", headers=headers).json()
        assert "外部验证" in revised_report["gaps"][-1]
        operations = client.get(
            f"/v1/runs/{run['id']}/operations", headers=headers
        ).json()["operations"]
        revision_operations = [
            item for item in operations if item["task_kind"] == "report_revision"
        ]
        assert [item["operation_kind"] for item in revision_operations] == [
            "lookup_evidence",
            "revise_report",
            "revision_validation",
            "save_revision",
        ]
        assert revision_operations[-1]["metrics"]["report_version"] == 2
        assert all(item["status"] == "completed" for item in revision_operations)


def test_conversation_rejects_unknown_models(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post(
            "/v1/projects", headers=headers, json={"name": "Model validation"}
        ).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "What evidence supports model validation?"},
        ).json()

        response = client.post(
            f"/v1/runs/{run['id']}/conversation/messages/stream",
            headers=headers,
            json={"content": "Continue", "model": "unknown-model"},
        )

        assert response.status_code == 422

        supported = client.post(
            f"/v1/runs/{run['id']}/conversation/messages/stream",
            headers=headers,
            json={"content": "Continue", "model": "gpt-5-mini"},
        )
        assert supported.status_code == 200


def test_project_runs_restore_history_and_streamed_reply_is_persisted(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post(
            "/v1/projects", headers=headers, json={"name": "Persistent chat"}
        ).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "What evidence supports longitudinal biomarker validation?"},
        ).json()
        first_message = "请先说明你将如何持续更新这个研究。"

        response = client.post(
            f"/v1/runs/{run['id']}/conversation/messages/stream",
            headers=headers,
            json={"content": first_message},
        )

        assert response.status_code == 200
        assert "event: delta" in response.text
        assert "event: complete" in response.text
        runs = client.get(f"/v1/projects/{project['id']}/runs", headers=headers).json()
        assert runs[0]["id"] == run["id"]
        conversation = client.get(
            f"/v1/runs/{run['id']}/conversation", headers=headers
        ).json()
        assert [message["role"] for message in conversation["messages"]] == [
            "user",
            "assistant",
        ]
        assert conversation["messages"][0]["content"] == first_message
        assert conversation["messages"][1]["content"]
        operations = client.get(
            f"/v1/runs/{run['id']}/operations", headers=headers
        ).json()["operations"]
        discussion_operations = [
            item for item in operations if item["task_kind"] == "discussion"
        ]
        assert [item["operation_kind"] for item in discussion_operations] == [
            "lookup_evidence",
            "grounded_response",
            "citation_audit",
            "save_response",
        ]
        assert all(
            item["conversation_message_id"] == conversation["messages"][0]["id"]
            for item in discussion_operations
        )


def test_run_conversation_is_isolated_by_authenticated_user(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        owner = login(client, "conversation-owner@example.com")
        stranger = login(client, "conversation-stranger@example.com")
        project = client.post(
            "/v1/projects", headers=owner, json={"name": "Private conversation"}
        ).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=owner,
            json={"question": "What evidence supports response biomarker validation studies?"},
        ).json()

        assert client.get(
            f"/v1/runs/{run['id']}/conversation", headers=stranger
        ).status_code == 404


def test_run_operations_are_versioned_ordered_isolated_and_streamed(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        owner = login(client, "operation-owner@example.com")
        stranger = login(client, "operation-stranger@example.com")
        project = client.post(
            "/v1/projects", headers=owner, json={"name": "Operation timeline"}
        ).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=owner,
            json={"question": "What evidence supports durable biomarker validation?"},
        ).json()
        run = start_run(client, owner, run["id"])

        response = client.get(f"/v1/runs/{run['id']}/operations", headers=owner)

        assert response.status_code == 200
        body = response.json()
        assert body["contract_version"] == "1.0"
        assert body["operations"]
        assert [item["sequence"] for item in body["operations"]] == sorted(
            item["sequence"] for item in body["operations"]
        )
        assert set(body["operations"][0]) == {
            "id",
            "run_id",
            "sequence",
            "task_kind",
            "operation_kind",
            "stage",
            "title",
            "summary",
            "status",
            "metrics",
            "conversation_message_id",
            "started_at",
            "completed_at",
        }
        assert client.get(
            f"/v1/runs/{run['id']}/operations", headers=stranger
        ).status_code == 404

        stream = client.get(f"/v1/runs/{run['id']}/events", headers=owner)
        assert stream.status_code == 200
        assert "event: operation" in stream.text
        assert f"id: {body['operations'][0]['id']}" in stream.text


def test_deleting_project_cascades_to_run_operations(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        headers = login(client)
        project = client.post(
            "/v1/projects", headers=headers, json={"name": "Disposable operations"}
        ).json()
        run = client.post(
            f"/v1/projects/{project['id']}/runs",
            headers=headers,
            json={"question": "What evidence supports deletion-safe operation history?"},
        ).json()
        run = start_run(client, headers, run["id"])
        assert client.get(
            f"/v1/runs/{run['id']}/operations", headers=headers
        ).status_code == 200

        assert client.delete(f"/v1/projects/{project['id']}", headers=headers).status_code == 204
        with client.app.state.database.session() as session:
            assert session.query(RunOperationEntity).count() == 0


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
        assert response.json() == {
            "status": "ok",
            "service": "paperpilot-api",
            "mode": "demo",
        }


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
        run = start_run(client, headers, run["id"])

        response = client.get(f"/v1/runs/{run['id']}/report.md", headers=headers)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/markdown")
        assert "## 主要结论" in response.text
        assert "PMID: 39000001" in response.text
        assert "停止条件" in response.text
