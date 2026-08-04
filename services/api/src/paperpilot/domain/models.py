from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, HttpUrl, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    normalized = re.sub(r"^(?:https?://)?(?:dx\.)?doi\.org/", "", normalized)
    normalized = re.sub(r"^doi:\s*", "", normalized)
    return normalized or None


def normalize_pmid(value: str | None) -> str | None:
    if not value:
        return None
    normalized = re.sub(r"^pmid:\s*", "", value.strip(), flags=re.IGNORECASE)
    digits = re.sub(r"\D", "", normalized)
    return digits or None


class RunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    WAITING = "waiting"
    RETRYING = "retrying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RunStage(str, Enum):
    PLANNING = "planning"
    SEARCHING = "searching"
    DEDUPLICATING = "deduplicating"
    SCREENING = "screening"
    PARSING = "parsing"
    EXTRACTING = "extracting"
    SYNTHESIZING = "synthesizing"
    RECOMMENDING = "recommending"
    AUDITING = "auditing"


class ResearchBrief(BaseModel):
    question: Annotated[str, Field(min_length=20, max_length=2000)]
    population: str | None = None
    intervention: str | None = None
    comparison: str | None = None
    outcomes: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    date_from: int | None = Field(default=None, ge=1900, le=2100)
    date_to: int | None = Field(default=None, ge=1900, le=2100)
    study_types: list[str] = Field(default_factory=list)
    model: Literal[
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "gpt-5-mini",
        "qwen-plus",
    ] | None = None

    @field_validator("question")
    @classmethod
    def trim_question(cls, value: str) -> str:
        return value.strip()


class Paper(BaseModel):
    id: str
    title: Annotated[str, Field(min_length=3)]
    abstract: str = ""
    year: int | None = Field(default=None, ge=1800, le=2100)
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    authors: list[str] = Field(default_factory=list)
    journal: str | None = None
    url: str | None = None
    source: str

    _doi = field_validator("doi", mode="before")(normalize_doi)
    _pmid = field_validator("pmid", mode="before")(normalize_pmid)


class EvidenceRecord(BaseModel):
    id: str = Field(default_factory=lambda: f"ev-{uuid4().hex[:12]}")
    paper_id: str
    excerpt: Annotated[str, Field(min_length=20, max_length=8000)]
    locator: Annotated[str, Field(min_length=1, max_length=500)]
    evidence_type: str
    confidence: float = Field(ge=0, le=1)
    doi: str | None = None
    pmid: str | None = None
    created_at: datetime = Field(default_factory=utc_now)

    _doi = field_validator("doi", mode="before")(normalize_doi)
    _pmid = field_validator("pmid", mode="before")(normalize_pmid)


class Claim(BaseModel):
    id: str = Field(default_factory=lambda: f"claim-{uuid4().hex[:12]}")
    statement: Annotated[str, Field(min_length=10, max_length=4000)]
    evidence_ids: Annotated[list[str], Field(min_length=1)]
    confidence: float = Field(default=0.75, ge=0, le=1)


class Recommendation(BaseModel):
    id: str = Field(default_factory=lambda: f"rec-{uuid4().hex[:12]}")
    title: Annotated[str, Field(min_length=5, max_length=300)]
    rationale: Annotated[str, Field(min_length=10, max_length=3000)]
    hypothesis: Annotated[str, Field(min_length=10, max_length=2000)]
    minimal_validation: Annotated[str, Field(min_length=10, max_length=3000)]
    resources: Annotated[list[str], Field(min_length=1)]
    risks: Annotated[list[str], Field(min_length=1)]
    stop_condition: Annotated[str, Field(min_length=5, max_length=1000)]
    evidence_ids: Annotated[list[str], Field(min_length=1)]


class DatasetModality(str, Enum):
    BULK_RNA = "bulk_rna"
    SINGLE_CELL = "single_cell"
    SPATIAL = "spatial"
    ATAC_SEQ = "atac_seq"
    GENOMICS = "genomics"


class PublicDataset(BaseModel):
    id: str = Field(default_factory=lambda: f"dataset-{uuid4().hex[:12]}")
    accession: Annotated[str, Field(min_length=2, max_length=200)]
    title: Annotated[str, Field(min_length=3, max_length=1000)]
    source: Annotated[str, Field(min_length=2, max_length=100)]
    modality: DatasetModality
    organism: str | None = None
    sample_count: int | None = Field(default=None, ge=0)
    summary: str = Field(default="", max_length=3000)
    data_types: list[str] = Field(default_factory=list)
    access: str = "open"
    url: HttpUrl


class TimelineItem(BaseModel):
    year: int
    title: str
    description: str
    paper_ids: list[str] = Field(default_factory=list)


class Report(BaseModel):
    schema_version: str = "1.1"
    title: str
    summary: str
    themes: list[str] = Field(default_factory=list)
    timeline: list[TimelineItem] = Field(default_factory=list)
    claims: list[Claim]
    evidence: list[EvidenceRecord]
    related_datasets: list[PublicDataset] = Field(default_factory=list)
    controversies: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    recommendations: Annotated[list[Recommendation], Field(min_length=3, max_length=3)]
    papers: list[Paper]
    generated_at: datetime = Field(default_factory=utc_now)
    disclaimer: str = "仅用于研究情报，不构成诊断、用药或治疗建议。"
