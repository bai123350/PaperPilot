from __future__ import annotations

from typing import Annotated, Protocol

from pydantic import BaseModel, Field, ValidationError

from paperpilot.domain.models import Claim, EvidenceRecord, Paper, Recommendation, ResearchBrief
from paperpilot.models.deepseek import ModelResponseError


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
        request_payload = {
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
            "output_schema": SynthesisPayload.model_json_schema(),
        }
        payload = await self.model.complete_json(self._system_prompt(), request_payload)
        try:
            synthesis = SynthesisPayload.model_validate(payload)
        except ValidationError as first_error:
            correction_payload = {
                **request_payload,
                "validation_errors": [
                    {"location": list(error["loc"]), "type": error["type"]}
                    for error in first_error.errors(include_url=False, include_input=False)
                ],
            }
            corrected = await self.model.complete_json(
                self._correction_prompt(), correction_payload
            )
            try:
                synthesis = SynthesisPayload.model_validate(corrected)
            except ValidationError:
                raise ModelResponseError("DeepSeek returned an invalid synthesis payload") from None

        allowed = {item.id for item in evidence}
        cited = {
            evidence_id
            for section in (synthesis.claims, synthesis.recommendations)
            for item in section
            for evidence_id in item.evidence_ids
        }
        unknown = cited - allowed
        if unknown:
            raise ModelResponseError("DeepSeek cited evidence outside the current research run")
        return synthesis.model_dump(mode="json")

    async def aclose(self) -> None:
        close = getattr(self.model, "aclose", None)
        if close is not None:
            await close()

    @staticmethod
    def _system_prompt() -> str:
        return (
            "You synthesize biomedical research intelligence from the supplied Evidence Records only. "
            "Return JSON only and conform exactly to the supplied output_schema. Include summary, themes, "
            "claims, controversies, gaps, and exactly three recommendations. Every claim and recommendation "
            "must cite one or more supplied evidence_ids. Never invent or alter an evidence ID. "
            "Each recommendation requires title, rationale, hypothesis, minimal_validation, resources, risks, "
            "stop_condition, and evidence_ids. Write substantive field values that satisfy all schema length "
            "constraints. Do not provide diagnosis, medication, or treatment advice."
        )

    @staticmethod
    def _correction_prompt() -> str:
        return (
            "Generate the biomedical synthesis again as JSON only. The prior response failed structural "
            "validation at the supplied validation_errors locations. Conform exactly to output_schema, return "
            "exactly three recommendations, and cite only evidence IDs present in the supplied evidence list. "
            "Do not discuss the correction and do not wrap the JSON in Markdown."
        )
