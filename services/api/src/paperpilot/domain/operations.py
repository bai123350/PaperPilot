from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from paperpilot.domain.models import RunStage


class OperationStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class OperationTaskKind(str, Enum):
    RESEARCH_RUN = "research_run"
    DISCUSSION = "discussion"
    REPORT_REVISION = "report_revision"


class OperationKind(str, Enum):
    STRUCTURE_QUESTION = "structure_question"
    SEARCH_SOURCE = "search_source"
    SEARCH_DATASET_SOURCE = "search_dataset_source"
    DEDUPLICATE = "deduplicate"
    SCREEN = "screen"
    PARSE = "parse"
    CREATE_EVIDENCE = "create_evidence"
    SYNTHESIZE = "synthesize"
    RECOMMEND = "recommend"
    CITATION_AUDIT = "citation_audit"
    SAVE_REPORT = "save_report"
    LOOKUP_EVIDENCE = "lookup_evidence"
    GROUNDED_RESPONSE = "grounded_response"
    SAVE_RESPONSE = "save_response"
    REVISE_REPORT = "revise_report"
    REVISION_VALIDATION = "revision_validation"
    SAVE_REVISION = "save_revision"


class OperationUpdate(BaseModel):
    task_kind: OperationTaskKind
    operation_kind: OperationKind
    stage: RunStage | None = None
    metrics: dict[str, int] = Field(default_factory=dict)


class RunOperation(BaseModel):
    id: str
    run_id: str
    sequence: int
    task_kind: OperationTaskKind
    operation_kind: OperationKind
    stage: RunStage | None = None
    title: str
    summary: str
    status: OperationStatus
    metrics: dict[str, int] = Field(default_factory=dict)
    conversation_message_id: str | None = None
    started_at: datetime
    completed_at: datetime | None = None
