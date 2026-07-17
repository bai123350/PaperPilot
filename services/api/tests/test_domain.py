from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from paperpilot.domain.models import (
    EvidenceRecord,
    Recommendation,
    ResearchBrief,
    RunStatus,
)


def test_research_brief_requires_a_meaningful_question() -> None:
    with pytest.raises(ValidationError):
        ResearchBrief(question="short")


def test_evidence_record_normalizes_external_identifiers() -> None:
    evidence = EvidenceRecord(
        paper_id="paper-1",
        excerpt="The intervention reduced the primary outcome at 12 weeks.",
        locator="Results, p. 7",
        evidence_type="result",
        confidence=0.91,
        doi=" HTTPS://DOI.ORG/10.1000/ABC.123 ",
        pmid=" PMID: 12345678 ",
    )

    assert evidence.doi == "10.1000/abc.123"
    assert evidence.pmid == "12345678"


def test_recommendation_requires_evidence_and_a_stop_condition() -> None:
    with pytest.raises(ValidationError):
        Recommendation(
            title="Validate the biomarker prospectively",
            rationale="Retrospective cohorts show a reproducible association.",
            hypothesis="The biomarker predicts response before treatment.",
            minimal_validation="Prospective observational cohort with blinded assessment.",
            resources=["Biobank", "Assay platform"],
            risks=["Spectrum bias"],
            stop_condition="",
            evidence_ids=[],
        )


def test_run_status_values_match_the_public_contract() -> None:
    assert {status.value for status in RunStatus} == {
        "queued",
        "running",
        "waiting",
        "retrying",
        "completed",
        "failed",
        "cancelled",
    }


def test_evidence_timestamps_are_timezone_aware() -> None:
    evidence = EvidenceRecord(
        paper_id="paper-1",
        excerpt="A sufficiently long evidence excerpt for auditability.",
        locator="Abstract",
        evidence_type="result",
        confidence=0.8,
        created_at=datetime.now(timezone.utc),
    )
    assert evidence.created_at.tzinfo is not None
