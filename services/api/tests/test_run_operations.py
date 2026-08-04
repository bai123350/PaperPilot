from pathlib import Path

from sqlalchemy import select

from paperpilot.config import Settings
from paperpilot.database import (
    Database,
    ProjectEntity,
    RunEntity,
    RunOperationEntity,
    UserEntity,
)
from paperpilot.run_service import RunService


def test_default_run_service_uses_live_sources(tmp_path: Path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'live-sources.db'}")
    database.create_schema()
    service = RunService(
        database,
        Settings(
            _env_file=None,
            database_url=f"sqlite:///{tmp_path / 'live-sources.db'}",
            storage_path=tmp_path / "uploads",
        ),
    )

    assert {connector.name for connector in service._connectors("missing-project")} == {
        "pubmed",
        "europe_pmc",
        "crossref",
        "openalex",
    }
    assert {connector.name for connector in service._dataset_connectors()} == {
        "ncbi_geo_datasets",
        "encode_datasets",
    }


def test_demo_run_persists_safe_ordered_operations(tmp_path: Path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'run-operations.db'}")
    database.create_schema()
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'run-operations.db'}",
        storage_path=tmp_path / "uploads",
        demo_mode=True,
        task_always_eager=True,
        auth_secret="test-secret-that-is-long-enough",
    )
    private_question = "Can a private biomarker question identify treatment response?"
    with database.session() as session:
        user = UserEntity(email="run-operations@example.com", name="Run operations")
        project = ProjectEntity(user=user, name="Run operation project")
        run = RunEntity(
            project=project,
            status="queued",
            brief={"question": private_question},
            events=[],
        )
        session.add(run)
        session.flush()
        run_id = run.id

    RunService(database, settings).execute(run_id)

    with database.session() as session:
        operations = list(
            session.scalars(
                select(RunOperationEntity)
                .where(RunOperationEntity.run_id == run_id)
                .order_by(RunOperationEntity.sequence)
            )
        )
    assert operations
    assert [item.sequence for item in operations] == list(range(1, len(operations) + 1))
    assert operations[-1].operation_kind == "save_report"
    assert operations[-1].status == "completed"
    assert all(private_question not in item.title for item in operations)
    assert all(private_question not in item.summary for item in operations)
