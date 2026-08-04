from pathlib import Path

import pytest
from sqlalchemy import select

from paperpilot.database import (
    Database,
    ProjectEntity,
    RunEntity,
    RunOperationEntity,
    UserEntity,
)
from paperpilot.domain.models import RunStage
from paperpilot.domain.operations import (
    OperationKind,
    OperationStatus,
    OperationTaskKind,
    OperationUpdate,
)
from paperpilot.services.operation_recorder import OperationRecorder


def build_recorder(tmp_path: Path) -> tuple[Database, OperationRecorder, str]:
    database = Database(f"sqlite:///{tmp_path / 'operations.db'}")
    database.create_schema()
    with database.session() as session:
        user = UserEntity(email="operations@example.com", name="Operations")
        project = ProjectEntity(user=user, name="Operation project")
        run = RunEntity(
            project=project,
            status="running",
            brief={"question": "private research question"},
            events=[],
        )
        session.add(run)
        session.flush()
        run_id = run.id
    return database, OperationRecorder(database), run_id


def test_recorder_persists_safe_ordered_operation_transitions(tmp_path: Path) -> None:
    database, recorder, run_id = build_recorder(tmp_path)

    operation_id = recorder.start(
        run_id,
        OperationUpdate(
            task_kind=OperationTaskKind.RESEARCH_RUN,
            operation_kind=OperationKind.SEARCH_SOURCE,
            stage=RunStage.SEARCHING,
            metrics={"source_count": 1},
        ),
    )
    recorder.complete(
        operation_id,
        {"candidate_count": 42, "duration_ms": 4800},
    )
    second_id = recorder.start(
        run_id,
        OperationUpdate(
            task_kind=OperationTaskKind.RESEARCH_RUN,
            operation_kind=OperationKind.DEDUPLICATE,
            stage=RunStage.DEDUPLICATING,
        ),
    )

    with database.session() as session:
        operations = list(
            session.scalars(
                select(RunOperationEntity)
                .where(RunOperationEntity.run_id == run_id)
                .order_by(RunOperationEntity.sequence)
            )
        )

    assert [item.id for item in operations] == [operation_id, second_id]
    assert [item.sequence for item in operations] == [1, 2]
    assert operations[0].status == OperationStatus.COMPLETED.value
    assert operations[0].title == "检索文献来源"
    assert operations[0].summary == "已完成 1 个文献来源检索，发现 42 篇候选文献。"
    assert operations[0].metrics == {
        "source_count": 1,
        "candidate_count": 42,
        "duration_ms": 4800,
    }
    assert "private research question" not in operations[0].summary


def test_recorder_rejects_unsafe_metrics_and_terminal_rewrites(tmp_path: Path) -> None:
    _, recorder, run_id = build_recorder(tmp_path)
    update = OperationUpdate(
        task_kind=OperationTaskKind.RESEARCH_RUN,
        operation_kind=OperationKind.SEARCH_SOURCE,
        stage=RunStage.SEARCHING,
    )

    with pytest.raises(ValueError, match="Unsupported operation metric"):
        recorder.start(run_id, update.model_copy(update={"metrics": {"query": 1}}))
    with pytest.raises(ValueError, match="must be a non-negative integer"):
        recorder.start(run_id, update.model_copy(update={"metrics": {"candidate_count": "42"}}))

    operation_id = recorder.start(run_id, update)
    recorder.fail(operation_id, "provider_unavailable")
    with pytest.raises(ValueError, match="terminal"):
        recorder.complete(operation_id)
