import httpx

from paperpilot.domain.models import (
    DatasetModality,
    Paper,
    PublicDataset,
    ResearchBrief,
    RunStage,
)
from paperpilot.domain.operations import OperationUpdate
from paperpilot.services.pipeline import ResearchPipeline


class StubConnector:
    name = "stub"

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        return [
            Paper(
                id="paper-1",
                title="Prospective validation of a circulating biomarker",
                abstract=(
                    "In a prospective cohort of 280 participants, the biomarker predicted "
                    "response with an area under the curve of 0.82. External validation is needed."
                ),
                year=2024,
                pmid="12345678",
                source=self.name,
            )
        ]


class StubDatasetConnector:
    name = "stub_datasets"

    async def search(self, brief: ResearchBrief) -> list[PublicDataset]:
        return [
            PublicDataset(
                id="dataset-1",
                accession="GSE12345",
                title="Single-cell validation atlas",
                source="NCBI GEO",
                modality=DatasetModality.SINGLE_CELL,
                organism="Homo sapiens",
                sample_count=24,
                summary="A public single-cell cohort for independent validation.",
                data_types=["scRNA-seq"],
                url="https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12345",
            )
        ]


class UnavailableConnector:
    name = "unavailable"

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        raise httpx.ConnectError("source unavailable")


class StubSynthesizer:
    async def synthesize(self, brief, papers, evidence):
        evidence_ids = [item.id for item in evidence]
        recommendation = {
            "rationale": "The evidence base still needs an independent cohort.",
            "hypothesis": "The reported effect will persist in a new cohort.",
            "minimal_validation": "Run a prospectively registered external validation cohort.",
            "resources": ["Independent biobank"],
            "risks": ["Spectrum bias"],
            "stop_condition": "Stop if discrimination is below 0.65.",
            "evidence_ids": evidence_ids,
        }
        return {
            "summary": "Model-generated synthesis grounded in the supplied evidence records.",
            "themes": ["External validation"],
            "claims": [
                {
                    "statement": "Prospective evidence reports useful discrimination.",
                    "evidence_ids": evidence_ids,
                    "confidence": 0.85,
                }
            ],
            "controversies": ["Thresholds vary between cohorts."],
            "gaps": ["Independent validation is limited."],
            "recommendations": [
                {"title": "Prospective validation", **recommendation},
                {"title": "External replication", **recommendation},
                {"title": "Assay harmonization", **recommendation},
            ],
        }


class OperationCollector:
    def __init__(self) -> None:
        self.started: dict[str, OperationUpdate] = {}
        self.completed: list[tuple[OperationUpdate, dict[str, int]]] = []
        self.failed: list[str] = []

    def start(self, update: OperationUpdate) -> str:
        operation_id = f"operation-{len(self.started) + 1}"
        self.started[operation_id] = update
        return operation_id

    def complete(self, operation_id: str, metrics: dict[str, int] | None = None) -> None:
        self.completed.append((self.started[operation_id], metrics or {}))

    def fail(self, operation_id: str, error_category: str) -> None:
        self.failed.append(error_category)


async def test_pipeline_emits_ordered_stages_and_builds_an_auditable_report() -> None:
    stages: list[RunStage] = []
    operations = OperationCollector()
    pipeline = ResearchPipeline(
        connectors=[StubConnector()],
        dataset_connectors=[StubDatasetConnector()],
    )

    report = await pipeline.run(
        ResearchBrief(question="What is the evidence for circulating biomarkers in treatment response?"),
        on_stage=lambda stage: stages.append(stage),
        on_operation=operations,
    )

    assert stages == list(RunStage)
    assert report.schema_version == "1.1"
    assert report.claims
    assert all(claim.evidence_ids for claim in report.claims)
    assert len(report.recommendations) == 3
    assert all(item.evidence_ids and item.stop_condition for item in report.recommendations)
    assert report.related_datasets[0].accession == "GSE12345"
    assert [update.operation_kind.value for update, _ in operations.completed] == [
        "structure_question",
        "search_source",
        "search_dataset_source",
        "deduplicate",
        "screen",
        "parse",
        "create_evidence",
        "synthesize",
        "recommend",
        "citation_audit",
    ]
    completed_metrics = {
        update.operation_kind.value: metrics for update, metrics in operations.completed
    }
    assert completed_metrics["search_source"]["candidate_count"] == 1
    assert completed_metrics["search_dataset_source"]["dataset_count"] == 1
    assert completed_metrics["create_evidence"]["evidence_count"] == 1
    assert completed_metrics["recommend"]["recommendation_count"] == 3


async def test_pipeline_uses_the_configured_evidence_synthesizer() -> None:
    pipeline = ResearchPipeline(connectors=[StubConnector()], synthesizer=StubSynthesizer())

    report = await pipeline.run(
        ResearchBrief(question="What is the evidence for circulating biomarkers in treatment response?"),
        on_stage=lambda _: None,
    )

    assert report.summary.startswith("Model-generated")
    assert report.themes == ["External validation"]


async def test_pipeline_continues_when_one_literature_source_is_unavailable() -> None:
    pipeline = ResearchPipeline(connectors=[UnavailableConnector(), StubConnector()])

    report = await pipeline.run(
        ResearchBrief(question="What evidence supports robust external biomarker validation?"),
        on_stage=lambda _: None,
    )

    assert report.papers[0].source == "stub"
    assert report.evidence
