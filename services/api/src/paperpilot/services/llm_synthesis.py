from __future__ import annotations

from typing import Annotated, Protocol

from pydantic import BaseModel, Field

from paperpilot.domain.models import Claim, EvidenceRecord, Paper, Recommendation, ResearchBrief


class JsonModel(Protocol):
    async def complete_json(self, system_prompt: str, payload: dict) -> dict: ...


class SynthesisPayload(BaseModel):
    summary: Annotated[str, Field(min_length=20, max_length=6000)]
    themes: list[str]
    claims: Annotated[list[Claim], Field(min_length=1)]
    controversies: list[str]
    gaps: Annotated[list[str], Field(min_length=1)]
    recommendations: Annotated[list[Recommendation], Field(min_length=3, max_length=3)]


class LlmReportSynthesizer:
    def __init__(self, model: JsonModel) -> None:
        self.model = model

    async def synthesize(
        self,
        brief: ResearchBrief,
        papers: list[Paper],
        evidence: list[EvidenceRecord],
    ) -> dict:
        payload = await self.model.complete_json(
            self._system_prompt(),
            {
                "research_brief": brief.model_dump(mode="json", exclude_none=True),
                "papers": [
                    {"id": paper.id, "title": paper.title, "year": paper.year}
                    for paper in papers
                ],
                "evidence": [
                    {
                        "id": item.id,
                        "paper_id": item.paper_id,
                        "excerpt": item.excerpt,
                        "locator": item.locator,
                        "evidence_type": item.evidence_type,
                    }
                    for item in evidence
                ],
            },
        )
        allowed = {item.id for item in evidence}
        cited = {
            evidence_id
            for section in (payload.get("claims", []), payload.get("recommendations", []))
            for item in section
            for evidence_id in item.get("evidence_ids", [])
        }
        unknown = cited - allowed
        if unknown:
            raise ValueError(f"Model cited unknown evidence IDs: {sorted(unknown)}")
        return SynthesisPayload.model_validate(payload).model_dump(mode="json")

    @staticmethod
    def _system_prompt() -> str:
        return (
            "You synthesize biomedical research intelligence from the supplied Evidence Records only. "
            "Return one JSON object with summary, themes, claims, controversies, gaps, and exactly three "
            "recommendations. Every claim and recommendation must cite one or more supplied evidence_ids. "
            "Each recommendation requires title, rationale, hypothesis, minimal_validation, resources, risks, "
            "stop_condition, and evidence_ids. Do not provide diagnosis, medication, or treatment advice."
        )
