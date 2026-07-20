import httpx

from paperpilot.domain.models import Paper, ResearchBrief, RunStage
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


async def test_pipeline_emits_ordered_stages_and_builds_an_auditable_report() -> None:
    stages: list[RunStage] = []
    pipeline = ResearchPipeline(connectors=[StubConnector()])

    report = await pipeline.run(
        ResearchBrief(question="What is the evidence for circulating biomarkers in treatment response?"),
        on_stage=lambda stage: stages.append(stage),
    )

    assert stages == list(RunStage)
    assert report.schema_version == "1.0"
    assert report.claims
    assert all(claim.evidence_ids for claim in report.claims)
    assert len(report.recommendations) == 3
    assert all(item.evidence_ids and item.stop_condition for item in report.recommendations)


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
