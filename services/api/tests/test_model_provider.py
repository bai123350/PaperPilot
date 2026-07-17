import httpx
import pytest

from paperpilot.domain.models import EvidenceRecord, Paper, ResearchBrief
from paperpilot.models.openai_compatible import OpenAICompatibleModel
from paperpilot.services.llm_synthesis import LlmReportSynthesizer


async def test_openai_compatible_model_parses_fenced_json() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = __import__("json").loads(request.content)
        assert payload["model"] == "qwen-research"
        assert payload["response_format"] == {"type": "json_object"}
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "```json\n{\"summary\": \"Grounded\"}\n```"}}]},
        )

    model = OpenAICompatibleModel(
        base_url="https://model.example/v1",
        api_key="secret",
        model="qwen-research",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    assert await model.complete_json("system", {"evidence": []}) == {"summary": "Grounded"}


class InvalidEvidenceModel:
    async def complete_json(self, system_prompt: str, payload: dict) -> dict:
        return {
            "summary": "A sufficiently detailed evidence-grounded summary.",
            "themes": ["Validation"],
            "claims": [
                {"statement": "A sufficiently detailed supported claim.", "evidence_ids": ["unknown"]}
            ],
            "controversies": [],
            "gaps": ["External validation is limited."],
            "recommendations": [],
        }


async def test_synthesizer_rejects_model_citations_outside_the_evidence_set() -> None:
    synthesizer = LlmReportSynthesizer(InvalidEvidenceModel())
    evidence = EvidenceRecord(
        id="allowed",
        paper_id="paper-1",
        excerpt="An external cohort confirmed the direction of the observed association.",
        locator="Abstract",
        evidence_type="result",
        confidence=0.8,
    )

    with pytest.raises(ValueError, match="unknown evidence"):
        await synthesizer.synthesize(
            ResearchBrief(question="What evidence supports external biomarker validation?"),
            [Paper(id="paper-1", title="External validation", abstract=evidence.excerpt, source="test")],
            [evidence],
        )
